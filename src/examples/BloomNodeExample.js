(() => {
    function animate() {
        requestAnimationFrame(animate);
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;
        postProcessing.renderAsync(scene, camera);
    }

    let canvas = document.getElementById("sample");
    const renderer = new window.WebGPURenderer({ canvas });
    const scene = new window.Scene();
    const camera = new window.PerspectiveCamera(75, window.innerWidth / window.innerHeight);
    const geometry = new window.BoxGeometry(1, 1, 1);
    const material = new window.MeshPhysicalMaterial({ color: 0x3c4b33 });
    const cube = new window.Mesh(geometry, material);
    const light = new window.PointLight(0xeeeced, 1000);

    light.position.set(2, 3, 4);
    camera.position.z = 5;
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.add(cube);
    scene.add(light);
    document.body.appendChild(renderer.domElement);

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

})();