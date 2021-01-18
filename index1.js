import * as THREE from 'https://unpkg.com/three/build/three.module.js';
import {
    ColladaLoader
} from 'https://threejs.org/examples/jsm/loaders/ColladaLoader.js';

let renderer = null;
let scene = null;
let camera = null;
let model = null;
let reticle = null;

function GetURLParameter(sParam) {
    const sPageURL = window.location.search.substring(1);
    const sURLVariables = sPageURL.split('&');
    for (let i = 0; i < sURLVariables.length; i++) {
        const sParameterName = sURLVariables[i].split('=');
        if (sParameterName[0] == sParam) {
            return sParameterName[1];
        }
    }
}

const initScene = (gl, session) => {
    //-- scene, camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    //---
    //--- chair model
    const loader = new ColladaLoader();
    loader.load('model.dae', (collada) => {
        model = new THREE.Object3D();
        const box = new THREE.Box3().setFromObject(collada.scene);

        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        collada.scene.position.set(-c.x, size.y / 2 - c.y, -c.z);
        
        model.add(collada.scene);
    });
    //---
    //--- light
    const light = new THREE.AmbientLight(0xFFFFFF);
    scene.add(light);

    //---
    // create and configure three.js renderer with XR support
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        //autoClear: true,
        context: gl,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.setSession(session);
    document.body.appendChild(renderer.domElement);
    //---
    // simple sprite to indicate detected surfaces
    reticle = new THREE.Mesh(
        new THREE.RingBufferGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshPhongMaterial({
            color: 0x0fff00
        })
    );
    //---
    // we will update it's matrix later using WebXR hit test pose matrix
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
    //---
};

// button to start XR experience
const xrButton = document.getElementById('xr-button');
// to display debug information
const info = document.getElementById('info');
// to control the xr session
let xrSession = null;
// reference space used within an application https://developer.mozilla.org/en-US/docs/Web/API/XRSession/requestReferenceSpace
let xrRefSpace = null;
// for hit testing with detected surfaces
let xrHitTestSource = null;

// Canvas OpenGL context used for rendering
let gl = null;

function checkXR() {
    if (!window.isSecureContext) {
        document.getElementById("warning").innerText = "WebXR unavailable. Please use secure context";
    }
    if (navigator.xr) {
        navigator.xr.addEventListener('devicechange', checkSupportedState);
        checkSupportedState();
    } else {
        document.getElementById("warning").innerText = "WebXR unavailable for this browser";
    }
}

function checkSupportedState() {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        if (supported) {
            xrButton.innerHTML = 'Enter AR';
            xrButton.addEventListener('click', onButtonClicked);
        } else {
            xrButton.innerHTML = 'AR not found';
        }
        xrButton.disabled = !supported;
    });
}

function onButtonClicked() {
    if (!xrSession) {
        navigator.xr.requestSession('immersive-ar', {
            optionalFeatures: ['dom-overlay'],
            requiredFeatures: ['local', 'hit-test'],
            domOverlay: {
                root: document.getElementById('overlay')
            }
        }).then(onSessionStarted, onRequestSessionError);
    } else {
        xrSession.end();
    }
}

function onSessionStarted(session) {
    xrSession = session;
    xrButton.innerHTML = 'Exit AR';

    // Show which type of DOM Overlay got enabled (if any)
    if (session.domOverlayState) {
        info.innerHTML = 'DOM Overlay type: ' + session.domOverlayState.type;
        //document.getElementById('warn').innerHTML = '携帯を動かしてください';
        document.getElementById('warn').innerHTML = '핸드폰을 움직여보세요';
    }

    // create a canvas element and WebGL context for rendering
    session.addEventListener('end', onSessionEnded);
    let canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl', {
        xrCompatible: true
    });
    session.updateRenderState({
        baseLayer: new XRWebGLLayer(session, gl)
    });

    // here we ask for viewer reference space, since we will be casting a ray
    // from a viewer towards a detected surface. The results of ray and surface intersection
    // will be obtained via xrHitTestSource variable
    session.requestReferenceSpace('viewer').then((refSpace) => {
        session.requestHitTestSource({
            space: refSpace,
            offsetRay: new XRRay(),
            entityTypes: ['plane']
        }).then((hitTestSource) => {
            xrHitTestSource = hitTestSource;
        });
    });

    session.requestReferenceSpace('local').then((refSpace) => {
        xrRefSpace = refSpace;
        session.requestAnimationFrame(onXRFrame);
    });

    document.getElementById("overlay").addEventListener('click', placeObject);

    // initialize three.js scene
    initScene(gl, session);
}

function onRequestSessionError(ex) {
    info.innerHTML = "Failed to start AR session.";
    console.error(ex.message);
}

function onSessionEnded(event) {
    xrSession = null;
    xrButton.innerHTML = 'Enter AR';
    info.innerHTML = '';
    gl = null;
    if (xrHitTestSource) xrHitTestSource.cancel();
    xrHitTestSource = null;
}

function placeObject() {
    if (reticle.visible && model) {
        const pos = reticle.getWorldPosition();
        //const distance = pos.distanceTo(new THREE.Vector3(0, 0, 0));

        reticle.visible = false;
        xrHitTestSource.cancel();
        xrHitTestSource = null;
        document.getElementById('warn').innerHTML = '';
        // we'll be placing our object right where the reticle was

        scene.remove(reticle);
        switch (GetURLParameter("model")) {
            case "chair":
                model.position.set(pos.x, pos.y, pos.z);
                scene.add(model);
        }

        // start object animation right away
        //toggleAnimation();
        // instead of placing an object we will just toggle animation state
        document.getElementById("overlay").removeEventListener('click', placeObject);
        document.getElementById("overlay").addEventListener('touchstart', touchObj);
    }
}

function touchObj(event) {
    //터치 판정
    //여기에 회전 추가할것.
}

// Utility function to update animated objects
function updateAnimation() {
    const warn = document.getElementById('warn');
    if (reticle.visible && model) {
        const pos = reticle.getWorldPosition();
        const distance = pos.distanceTo(new THREE.Vector3(0, 0, 0));
        if (distance < 1) {
            reticle.material.color.setHex(0xff0000);
            //warn.innerHTML = '距離が足りません。もっと遠くから設置してください。';
            warn.innerHTML = '너무 가깝습니다. 좀 더 멀리서 설치하세요'
        } else {
            reticle.material.color.setHex(0x0fff00);
            //warn.innerHTML = 'タップしてください。';
            warn.innerHTML = '눌러서 설치';
        }
    }
    if (reticle.visible && !model) {
        warn.innerHTML = '모델 파일을 로딩중입니다...';
    }
}


function onXRFrame(t, frame) {
    let session = frame.session;
    let xrViewerPose = frame.getViewerPose(xrRefSpace);
    session.requestAnimationFrame(onXRFrame);
    if (xrHitTestSource && xrViewerPose) {
        // obtain hit test results by casting a ray from the center of device screen
        // into AR view. Results indicate that ray intersected with one or more detected surfaces
        const hitTestResults = frame.getHitTestResults(xrHitTestSource);
        if (hitTestResults.length) {
            // obtain a local pose at the intersection point
            const pose = hitTestResults[0].getPose(xrRefSpace);
            // place a reticle at the intersection point
            reticle.matrix.fromArray(pose.transform.matrix);
            reticle.visible = true;

        }
    } else { // do not show a reticle if no surfaces are intersected
        reticle.visible = false;
    }
    //session.drawXRFrame(frame, xrViewerPose);
    // update object animation
    updateAnimation();
    // bind our gl context that was created with WebXR to threejs renderer
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    // render the scene
    renderer.render(scene, camera);
}

checkXR();
