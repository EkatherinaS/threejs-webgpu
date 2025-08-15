(() => {
  function animate() {
    requestAnimationFrame(animate);
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.renderAsync(scene, camera);
  }

  let canvas = document.getElementById("sample");
  const renderer = new window.WebGPURenderer({ canvas });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new window.Scene();
  scene.background = new window.Color().setHex(0x837574);

  const camera = new window.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight
  );
  camera.position.z = 4;

  const pointLight = new window.PointLight(0xececec, 42);
  pointLight.position.set(2, 3, 4);
  scene.add(pointLight);

  const geometry = new window.BoxGeometry(1, 1, 1);
  const tempMaterial = new window.MeshPhysicalMaterial({ color: 0x888888 });
  const cube = new window.Mesh(geometry, tempMaterial);

  scene.add(cube);

  const textureLoader = new window.TextureLoaderWithProgress();
  textureLoader.load(
    "/textures/Texturelabs_Wood_145S.jpg",
    (texture) => {
      const material = new window.MeshPhysicalMaterial({ map: texture });
      cube.material = material;
      console.info("Texture loaded");
    },
    (xhr) => {
      console.info("Load progress:", xhr.loaded, xhr.total);
    },
    (error) => {
      console.error("Error loading texture:", error);
    }
  );

  animate();
})();
