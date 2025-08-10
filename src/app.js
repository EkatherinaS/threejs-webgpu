function animate() {
    requestAnimationFrame(animate);
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    postProcessing.renderAsync(scene, camera);
}

const renderer = new window.WebGPURenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new window.Scene();
scene.background = new window.Color().setHex(0x837574);

const camera = new window.PerspectiveCamera(75, window.innerWidth / window.innerHeight);
camera.position.z = 4;

const geometry = new window.BoxGeometry(1, 1, 1);
const texture = new window.TextureLoaderWithProgress().load('/textures/companion_cube_texture.jpg');
const material = new window.MeshPhysicalMaterial({ map: texture });
const cube = new window.Mesh(geometry, material);
scene.add(cube);

const pointLight = new window.PointLight(0xececec, 42);
pointLight.position.set(2, 3, 4);
scene.add(pointLight);

//https://github.com/mrdoob/three.js/blob/master/examples/webgpu_postprocessing_bloom_selective.html
//https://threejs.org/examples/?q=bloom#webgpu_postprocessing_bloom_selective

const { pass, mrt, output, float, uniform } = THREE.tsl;

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, bloomIntensity: float(1) }));

const outputPass = scenePass.getTextureNode();
const bloomIntensityPass = scenePass.getTextureNode('bloomIntensity');
const bloomPass = THREE.shaders.bloom(outputPass.mul(bloomIntensityPass));
const postProcessing = new THREE.PostProcessing(renderer);
postProcessing.outputColorTransform = false;
postProcessing.outputNode = outputPass.add(bloomPass).renderOutput();

animate();

