(async () => {
  function animate() {
    requestAnimationFrame(animate);
    mesh.rotation.x += 0.01;
    mesh.rotation.y += 0.01;
    renderer.renderAsync(scene, camera);
  }

  let canvas = document.getElementById("sample");

  const renderer = new window.WebGPURenderer({
    canvas,
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new window.Scene();
  const camera = new window.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight
  );
  camera.position.z = 4;

  const pointLight = new window.PointLight(0xececec, 42);
  pointLight.position.set(2, 3, 4);
  scene.add(pointLight);

  //https://github.com/mrdoob/three.js/blob/master/examples/webgpu_loader_gltf.html

  const hdrLoader = new window.RGBELoader().setPath("../../public/textures/");
  const env = hdrLoader.load("royal_esplanade_1k.hdr");
  env.type = window.HalfFloatType;
  env.mapping = window.EquirectangularReflectionMapping;

  scene.background = env;
  scene.environment = env;
  scene.backgroundBlurriness = 0.1;
  scene.environmentIntensity = 1.25;

  const geometry = new window.BoxGeometry(1, 1, 1);
  const material = new window.MeshPhysicalMaterial({
    color: 0xaaaaaa,
    roughness: 0,
    envMap: env,
  });
  const mesh = new window.Mesh(geometry, material);

  scene.add(mesh);
  animate();
})();
