(() => {
  function animate() {
    requestAnimationFrame(animate);
    simplified.rotation.x += 0.01;
    simplified.rotation.y += 0.01;
    mesh.rotation.y += 0.01;
    mesh.rotation.y += 0.01;
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

  const geometry = new window.SphereGeometry(1, 32, 16);
  const tempMaterial = new window.MeshPhysicalMaterial({ color: 0x888888 });
  const mesh = new window.Mesh(geometry, tempMaterial);
  mesh.position.x = -2;
  mesh.rotation.y = -Math.PI / 2;

  scene.add(mesh);

  // https://threejs.org/examples/?q=sim#webgl_modifier_simplifier

  const modifier = new window.SimplifyModifier();

  const simplified = mesh.clone();
  simplified.material = simplified.material.clone();
  simplified.material.flatShading = true;
  const count = Math.floor(
    simplified.geometry.attributes.position.count * 0.875
  ); // number of vertices to remove
  simplified.geometry = modifier.modify(simplified.geometry, count);

  simplified.position.x = 2;
  simplified.rotation.y = -Math.PI / 2;
  scene.add(simplified);

  animate();
})();
