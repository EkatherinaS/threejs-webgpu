(() => {
  if (!window.THREE) {
    window.THREE = {};
  }

  const THREE = window.THREE;

  if (!THREE.shaders) {
    THREE.shaders = {};
  }

  const { HalfFloatType, RenderTarget, RendererUtils } = THREE;

  const {
    add,
    float,
    Fn,
    int,
    Loop,
    luminance,
    mix,
    nodeObject,
    passTexture,
    smoothstep,
    texture,
    uniform,
    uniformArray,
    uv,
    vec4,
    QuadMesh,
    TempNode,
    NodeMaterial,
    NodeUpdateType,
  } = THREE.tsl;

  class TextureLoaderWithProgress extends TextureLoader {
    constructor(manager) {
      super(manager);

      this._fileLoader = new FileLoader();
    }

    load(url, onLoad, onProgress, onError) {
      const result = new Texture();

      this._fileLoader.load(
        url,
        () => {
          super.load(
            url,
            (texture) => {
              result.image = texture.image;
              result.needsUpdate = true;

              if (onLoad !== undefined) {
                onLoad(result);
              }
            },
            () => {},
            onError
          );
        },
        onProgress,
        onError
      );

      return result;
    }
  }

  (() => {
    const _quadMesh = /*@__PURE__*/ new QuadMesh();
    const _size = /*@__PURE__*/ new Vector2();

    const _BlurDirectionX = /*@__PURE__*/ new Vector2(1.0, 0.0);
    const _BlurDirectionY = /*@__PURE__*/ new Vector2(0.0, 1.0);

    let _rendererState;

    class BloomNode extends TempNode {
      static get type() {
        return "BloomNode";
      }

      constructor(inputNode, strength = 1, radius = 0, threshold = 0) {
        super("vec4");

        this.inputNode = inputNode;
        this.strength = uniform(strength);
        this.radius = uniform(radius);
        this.threshold = uniform(threshold);
        this.smoothWidth = uniform(0.01);
        this._renderTargetsHorizontal = [];
        this._renderTargetsVertical = [];
        this._nMips = 5;

        this._renderTargetBright = new RenderTarget(1, 1, {
          depthBuffer: false,
          type: HalfFloatType,
        });
        this._renderTargetBright.texture.name = "UnrealBloomPass.bright";
        this._renderTargetBright.texture.generateMipmaps = false;

        //

        for (let i = 0; i < this._nMips; i++) {
          const renderTargetHorizontal = new RenderTarget(1, 1, {
            depthBuffer: false,
            type: HalfFloatType,
          });

          renderTargetHorizontal.texture.name = "UnrealBloomPass.h" + i;
          renderTargetHorizontal.texture.generateMipmaps = false;

          this._renderTargetsHorizontal.push(renderTargetHorizontal);

          const renderTargetVertical = new RenderTarget(1, 1, {
            depthBuffer: false,
            type: HalfFloatType,
          });

          renderTargetVertical.texture.name = "UnrealBloomPass.v" + i;
          renderTargetVertical.texture.generateMipmaps = false;

          this._renderTargetsVertical.push(renderTargetVertical);
        }

        this._compositeMaterial = null;
        this._highPassFilterMaterial = null;
        this._separableBlurMaterials = [];
        this._textureNodeBright = texture(this._renderTargetBright.texture);
        this._textureNodeBlur0 = texture(
          this._renderTargetsVertical[0].texture
        );
        this._textureNodeBlur1 = texture(
          this._renderTargetsVertical[1].texture
        );
        this._textureNodeBlur2 = texture(
          this._renderTargetsVertical[2].texture
        );
        this._textureNodeBlur3 = texture(
          this._renderTargetsVertical[3].texture
        );
        this._textureNodeBlur4 = texture(
          this._renderTargetsVertical[4].texture
        );
        this._textureOutput = passTexture(
          this,
          this._renderTargetsHorizontal[0].texture
        );
        this.updateBeforeType = NodeUpdateType.FRAME;
      }

      getTextureNode() {
        return this._textureOutput;
      }

      setSize(width, height) {
        let resx = Math.round(width / 2);
        let resy = Math.round(height / 2);

        this._renderTargetBright.setSize(resx, resy);

        for (let i = 0; i < this._nMips; i++) {
          this._renderTargetsHorizontal[i].setSize(resx, resy);
          this._renderTargetsVertical[i].setSize(resx, resy);

          this._separableBlurMaterials[i].invSize.value.set(1 / resx, 1 / resy);

          resx = Math.round(resx / 2);
          resy = Math.round(resy / 2);
        }
      }

      updateBefore(frame) {
        const { renderer } = frame;

        _rendererState = RendererUtils.resetRendererState(
          renderer,
          _rendererState
        );

        //

        const size = renderer.getDrawingBufferSize(_size);
        this.setSize(size.width, size.height);

        // 1. Extract bright areas

        renderer.setRenderTarget(this._renderTargetBright);
        _quadMesh.material = this._highPassFilterMaterial;
        _quadMesh.render(renderer);

        // 2. Blur all the mips progressively

        let inputRenderTarget = this._renderTargetBright;

        for (let i = 0; i < this._nMips; i++) {
          _quadMesh.material = this._separableBlurMaterials[i];

          this._separableBlurMaterials[i].colorTexture.value =
            inputRenderTarget.texture;
          this._separableBlurMaterials[i].direction.value = _BlurDirectionX;
          renderer.setRenderTarget(this._renderTargetsHorizontal[i]);
          _quadMesh.render(renderer);

          this._separableBlurMaterials[i].colorTexture.value =
            this._renderTargetsHorizontal[i].texture;
          this._separableBlurMaterials[i].direction.value = _BlurDirectionY;
          renderer.setRenderTarget(this._renderTargetsVertical[i]);
          _quadMesh.render(renderer);

          inputRenderTarget = this._renderTargetsVertical[i];
        }

        // 3. Composite all the mips

        renderer.setRenderTarget(this._renderTargetsHorizontal[0]);
        _quadMesh.material = this._compositeMaterial;
        _quadMesh.render(renderer);

        // restore

        RendererUtils.restoreRendererState(renderer, _rendererState);
      }

      setup(builder) {
        // luminosity high pass material

        const luminosityHighPass = Fn(() => {
          const texel = this.inputNode;
          const v = luminance(texel.rgb);

          const alpha = smoothstep(
            this.threshold,
            this.threshold.add(this.smoothWidth),
            v
          );

          return mix(vec4(0), texel, alpha);
        });

        this._highPassFilterMaterial =
          this._highPassFilterMaterial || new NodeMaterial();
        this._highPassFilterMaterial.fragmentNode =
          luminosityHighPass().context(builder.getSharedContext());
        this._highPassFilterMaterial.name = "Bloom_highPass";
        this._highPassFilterMaterial.needsUpdate = true;

        // gaussian blur materials

        // These sizes have been changed to account for the altered coefficents-calculation to avoid blockiness,
        // while retaining the same blur-strength. For details see https://github.com/mrdoob/three.js/pull/31528
        const kernelSizeArray = [6, 10, 14, 18, 22];

        for (let i = 0; i < this._nMips; i++) {
          this._separableBlurMaterials.push(
            this._getSeparableBlurMaterial(builder, kernelSizeArray[i])
          );
        }

        // composite material

        const bloomFactors = uniformArray([1.0, 0.8, 0.6, 0.4, 0.2]);
        const bloomTintColors = uniformArray([
          new Vector3(1, 1, 1),
          new Vector3(1, 1, 1),
          new Vector3(1, 1, 1),
          new Vector3(1, 1, 1),
          new Vector3(1, 1, 1),
        ]);

        const lerpBloomFactor = Fn(([factor, radius]) => {
          const mirrorFactor = float(1.2).sub(factor);
          return mix(factor, mirrorFactor, radius);
        }).setLayout({
          name: "lerpBloomFactor",
          type: "float",
          inputs: [
            { name: "factor", type: "float" },
            { name: "radius", type: "float" },
          ],
        });

        const compositePass = Fn(() => {
          const color0 = lerpBloomFactor(bloomFactors.element(0), this.radius)
            .mul(vec4(bloomTintColors.element(0), 1.0))
            .mul(this._textureNodeBlur0);
          const color1 = lerpBloomFactor(bloomFactors.element(1), this.radius)
            .mul(vec4(bloomTintColors.element(1), 1.0))
            .mul(this._textureNodeBlur1);
          const color2 = lerpBloomFactor(bloomFactors.element(2), this.radius)
            .mul(vec4(bloomTintColors.element(2), 1.0))
            .mul(this._textureNodeBlur2);
          const color3 = lerpBloomFactor(bloomFactors.element(3), this.radius)
            .mul(vec4(bloomTintColors.element(3), 1.0))
            .mul(this._textureNodeBlur3);
          const color4 = lerpBloomFactor(bloomFactors.element(4), this.radius)
            .mul(vec4(bloomTintColors.element(4), 1.0))
            .mul(this._textureNodeBlur4);

          const sum = color0.add(color1).add(color2).add(color3).add(color4);

          return sum.mul(this.strength);
        });

        this._compositeMaterial = this._compositeMaterial || new NodeMaterial();
        this._compositeMaterial.fragmentNode = compositePass().context(
          builder.getSharedContext()
        );
        this._compositeMaterial.name = "Bloom_comp";
        this._compositeMaterial.needsUpdate = true;

        //

        return this._textureOutput;
      }

      /**
       * Frees internal resources. This method should be called
       * when the effect is no longer required.
       */
      dispose() {
        for (let i = 0; i < this._renderTargetsHorizontal.length; i++) {
          this._renderTargetsHorizontal[i].dispose();
        }

        for (let i = 0; i < this._renderTargetsVertical.length; i++) {
          this._renderTargetsVertical[i].dispose();
        }

        this._renderTargetBright.dispose();
      }

      _getSeparableBlurMaterial(builder, kernelRadius) {
        const coefficients = [];
        const sigma = kernelRadius / 3;

        for (let i = 0; i < kernelRadius; i++) {
          coefficients.push(
            (0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma
          );
        }

        //

        const colorTexture = texture(null);
        const gaussianCoefficients = uniformArray(coefficients);
        const invSize = uniform(new Vector2());
        const direction = uniform(new Vector2(0.5, 0.5));

        const uvNode = uv();
        const sampleTexel = (uv) => colorTexture.sample(uv);

        const separableBlurPass = Fn(() => {
          const diffuseSum = sampleTexel(uvNode)
            .rgb.mul(gaussianCoefficients.element(0))
            .toVar();

          Loop(
            {
              start: int(1),
              end: int(kernelRadius),
              type: "int",
              condition: "<",
            },
            ({ i }) => {
              const x = float(i);
              const w = gaussianCoefficients.element(i);
              const uvOffset = direction.mul(invSize).mul(x);
              const sample1 = sampleTexel(uvNode.add(uvOffset)).rgb;
              const sample2 = sampleTexel(uvNode.sub(uvOffset)).rgb;
              diffuseSum.addAssign(add(sample1, sample2).mul(w));
            }
          );

          return vec4(diffuseSum, 1.0);
        });

        const separableBlurMaterial = new NodeMaterial();
        separableBlurMaterial.fragmentNode = separableBlurPass().context(
          builder.getSharedContext()
        );
        separableBlurMaterial.name = "Bloom_separable";
        separableBlurMaterial.needsUpdate = true;

        // uniforms
        separableBlurMaterial.colorTexture = colorTexture;
        separableBlurMaterial.direction = direction;
        separableBlurMaterial.invSize = invSize;

        return separableBlurMaterial;
      }
    }

    const bloom = (node, strength, radius, threshold) =>
      nodeObject(new BloomNode(nodeObject(node), strength, radius, threshold));
    THREE.shaders.bloom = bloom;
  })();

  (() => {
    function mergeVertices(geometry, tolerance = 1e-4) {
      tolerance = Math.max(tolerance, Number.EPSILON);

      // Generate an index buffer if the geometry doesn't have one, or optimize it
      // if it's already available.
      const hashToIndex = {};
      const indices = geometry.getIndex();
      const positions = geometry.getAttribute("position");
      const vertexCount = indices ? indices.count : positions.count;

      // next value for triangle indices
      let nextIndex = 0;

      // attributes and new attribute arrays
      const attributeNames = Object.keys(geometry.attributes);
      const tmpAttributes = {};
      const tmpMorphAttributes = {};
      const newIndices = [];
      const getters = ["getX", "getY", "getZ", "getW"];
      const setters = ["setX", "setY", "setZ", "setW"];

      // Initialize the arrays, allocating space conservatively. Extra
      // space will be trimmed in the last step.
      for (let i = 0, l = attributeNames.length; i < l; i++) {
        const name = attributeNames[i];
        const attr = geometry.attributes[name];

        tmpAttributes[name] = new attr.constructor(
          new attr.array.constructor(attr.count * attr.itemSize),
          attr.itemSize,
          attr.normalized
        );

        const morphAttributes = geometry.morphAttributes[name];
        if (morphAttributes) {
          if (!tmpMorphAttributes[name]) tmpMorphAttributes[name] = [];
          morphAttributes.forEach((morphAttr, i) => {
            const array = new morphAttr.array.constructor(
              morphAttr.count * morphAttr.itemSize
            );
            tmpMorphAttributes[name][i] = new morphAttr.constructor(
              array,
              morphAttr.itemSize,
              morphAttr.normalized
            );
          });
        }
      }

      // convert the error tolerance to an amount of decimal places to truncate to
      const halfTolerance = tolerance * 0.5;
      const exponent = Math.log10(1 / tolerance);
      const hashMultiplier = Math.pow(10, exponent);
      const hashAdditive = halfTolerance * hashMultiplier;
      for (let i = 0; i < vertexCount; i++) {
        const index = indices ? indices.getX(i) : i;

        // Generate a hash for the vertex attributes at the current index 'i'
        let hash = "";
        for (let j = 0, l = attributeNames.length; j < l; j++) {
          const name = attributeNames[j];
          const attribute = geometry.getAttribute(name);
          const itemSize = attribute.itemSize;

          for (let k = 0; k < itemSize; k++) {
            // double tilde truncates the decimal value
            hash += `${~~(
              attribute[getters[k]](index) * hashMultiplier +
              hashAdditive
            )},`;
          }
        }

        // Add another reference to the vertex if it's already
        // used by another index
        if (hash in hashToIndex) {
          newIndices.push(hashToIndex[hash]);
        } else {
          // copy data to the new index in the temporary attributes
          for (let j = 0, l = attributeNames.length; j < l; j++) {
            const name = attributeNames[j];
            const attribute = geometry.getAttribute(name);
            const morphAttributes = geometry.morphAttributes[name];
            const itemSize = attribute.itemSize;
            const newArray = tmpAttributes[name];
            const newMorphArrays = tmpMorphAttributes[name];

            for (let k = 0; k < itemSize; k++) {
              const getterFunc = getters[k];
              const setterFunc = setters[k];
              newArray[setterFunc](nextIndex, attribute[getterFunc](index));

              if (morphAttributes) {
                for (let m = 0, ml = morphAttributes.length; m < ml; m++) {
                  newMorphArrays[m][setterFunc](
                    nextIndex,
                    morphAttributes[m][getterFunc](index)
                  );
                }
              }
            }
          }

          hashToIndex[hash] = nextIndex;
          newIndices.push(nextIndex);
          nextIndex++;
        }
      }

      // generate result BufferGeometry
      const result = geometry.clone();
      for (const name in geometry.attributes) {
        const tmpAttribute = tmpAttributes[name];

        result.setAttribute(
          name,
          new tmpAttribute.constructor(
            tmpAttribute.array.slice(0, nextIndex * tmpAttribute.itemSize),
            tmpAttribute.itemSize,
            tmpAttribute.normalized
          )
        );

        if (!(name in tmpMorphAttributes)) continue;

        for (let j = 0; j < tmpMorphAttributes[name].length; j++) {
          const tmpMorphAttribute = tmpMorphAttributes[name][j];

          result.morphAttributes[name][j] = new tmpMorphAttribute.constructor(
            tmpMorphAttribute.array.slice(
              0,
              nextIndex * tmpMorphAttribute.itemSize
            ),
            tmpMorphAttribute.itemSize,
            tmpMorphAttribute.normalized
          );
        }
      }

      // indices

      result.setIndex(newIndices);

      return result;
    }
    const _cb = new Vector3(),
      _ab = new Vector3();

    class SimplifyModifier {
      modify(geometry, count) {
        geometry = geometry.clone();

        // currently morphAttributes are not supported
        delete geometry.morphAttributes.position;
        delete geometry.morphAttributes.normal;
        const attributes = geometry.attributes;

        // this modifier can only process indexed and non-indexed geometries with at least a position attribute

        for (const name in attributes) {
          if (
            name !== "position" &&
            name !== "uv" &&
            name !== "normal" &&
            name !== "tangent" &&
            name !== "color"
          )
            geometry.deleteAttribute(name);
        }

        geometry = mergeVertices(geometry);

        //
        // put data of original geometry in different data structures
        //

        const vertices = [];
        const faces = [];

        // add vertices

        const positionAttribute = geometry.getAttribute("position");
        const uvAttribute = geometry.getAttribute("uv");
        const normalAttribute = geometry.getAttribute("normal");
        const tangentAttribute = geometry.getAttribute("tangent");
        const colorAttribute = geometry.getAttribute("color");

        let t = null;
        let v2 = null;
        let nor = null;
        let col = null;

        for (let i = 0; i < positionAttribute.count; i++) {
          const v = new Vector3().fromBufferAttribute(positionAttribute, i);
          if (uvAttribute) {
            v2 = new Vector2().fromBufferAttribute(uvAttribute, i);
          }

          if (normalAttribute) {
            nor = new Vector3().fromBufferAttribute(normalAttribute, i);
          }

          if (tangentAttribute) {
            t = new Vector4().fromBufferAttribute(tangentAttribute, i);
          }

          if (colorAttribute) {
            col = new Color().fromBufferAttribute(colorAttribute, i);
          }

          const vertex = new Vertex(v, v2, nor, t, col);
          vertices.push(vertex);
        }

        // add faces

        let index = geometry.getIndex();

        if (index !== null) {
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);

            const triangle = new Triangle(
              vertices[a],
              vertices[b],
              vertices[c],
              a,
              b,
              c
            );
            faces.push(triangle);
          }
        } else {
          for (let i = 0; i < positionAttribute.count; i += 3) {
            const a = i;
            const b = i + 1;
            const c = i + 2;

            const triangle = new Triangle(
              vertices[a],
              vertices[b],
              vertices[c],
              a,
              b,
              c
            );
            faces.push(triangle);
          }
        }

        // compute all edge collapse costs

        for (let i = 0, il = vertices.length; i < il; i++) {
          computeEdgeCostAtVertex(vertices[i]);
        }

        let nextVertex;

        let z = count;

        while (z--) {
          nextVertex = minimumCostEdge(vertices);

          if (!nextVertex) {
            console.log("THREE.SimplifyModifier: No next vertex");
            break;
          }

          collapse(vertices, faces, nextVertex, nextVertex.collapseNeighbor);
        }

        //

        const simplifiedGeometry = new BufferGeometry();
        const position = [];
        const uv = [];
        const normal = [];
        const tangent = [];
        const color = [];

        index = [];

        //

        for (let i = 0; i < vertices.length; i++) {
          const vertex = vertices[i];
          position.push(
            vertex.position.x,
            vertex.position.y,
            vertex.position.z
          );
          if (vertex.uv) {
            uv.push(vertex.uv.x, vertex.uv.y);
          }

          if (vertex.normal) {
            normal.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
          }

          if (vertex.tangent) {
            tangent.push(
              vertex.tangent.x,
              vertex.tangent.y,
              vertex.tangent.z,
              vertex.tangent.w
            );
          }

          if (vertex.color) {
            color.push(vertex.color.r, vertex.color.g, vertex.color.b);
          }

          // cache final index to GREATLY speed up faces reconstruction
          vertex.id = i;
        }

        //

        for (let i = 0; i < faces.length; i++) {
          const face = faces[i];
          index.push(face.v1.id, face.v2.id, face.v3.id);
        }

        simplifiedGeometry.setAttribute(
          "position",
          new Float32BufferAttribute(position, 3)
        );
        if (uv.length > 0)
          simplifiedGeometry.setAttribute(
            "uv",
            new Float32BufferAttribute(uv, 2)
          );
        if (normal.length > 0)
          simplifiedGeometry.setAttribute(
            "normal",
            new Float32BufferAttribute(normal, 3)
          );
        if (tangent.length > 0)
          simplifiedGeometry.setAttribute(
            "tangent",
            new Float32BufferAttribute(tangent, 4)
          );
        if (color.length > 0)
          simplifiedGeometry.setAttribute(
            "color",
            new Float32BufferAttribute(color, 3)
          );

        simplifiedGeometry.setIndex(index);

        return simplifiedGeometry;
      }
    }

    function pushIfUnique(array, object) {
      if (array.indexOf(object) === -1) array.push(object);
    }

    function removeFromArray(array, object) {
      const k = array.indexOf(object);
      if (k > -1) array.splice(k, 1);
    }

    function computeEdgeCollapseCost(u, v) {
      // if we collapse edge uv by moving u to v then how
      // much different will the model change, i.e. the "error".

      const edgelength = v.position.distanceTo(u.position);
      let curvature = 0;

      const sideFaces = [];

      // find the "sides" triangles that are on the edge uv
      for (let i = 0, il = u.faces.length; i < il; i++) {
        const face = u.faces[i];

        if (face.hasVertex(v)) {
          sideFaces.push(face);
        }
      }

      // use the triangle facing most away from the sides
      // to determine our curvature term
      for (let i = 0, il = u.faces.length; i < il; i++) {
        let minCurvature = 1;
        const face = u.faces[i];

        for (let j = 0; j < sideFaces.length; j++) {
          const sideFace = sideFaces[j];
          // use dot product of face normals.
          const dotProd = face.normal.dot(sideFace.normal);
          minCurvature = Math.min(minCurvature, (1.001 - dotProd) / 2);
        }

        curvature = Math.max(curvature, minCurvature);
      }

      // crude approach in attempt to preserve borders
      // though it seems not to be totally correct
      const borders = 0;

      if (sideFaces.length < 2) {
        // we add some arbitrary cost for borders,
        // borders += 10;
        curvature = 1;
      }

      const amt = edgelength * curvature + borders;

      return amt;
    }

    function computeEdgeCostAtVertex(v) {
      // compute the edge collapse cost for all edges that start
      // from vertex v.  Since we are only interested in reducing
      // the object by selecting the min cost edge at each step, we
      // only cache the cost of the least cost edge at this vertex
      // (in member variable collapse) as well as the value of the
      // cost (in member variable collapseCost).

      if (v.neighbors.length === 0) {
        // collapse if no neighbors.
        v.collapseNeighbor = null;
        v.collapseCost = -0.01;

        return;
      }

      v.collapseCost = 100000;
      v.collapseNeighbor = null;

      // search all neighboring edges for "least cost" edge
      for (let i = 0; i < v.neighbors.length; i++) {
        const collapseCost = computeEdgeCollapseCost(v, v.neighbors[i]);

        if (!v.collapseNeighbor) {
          v.collapseNeighbor = v.neighbors[i];
          v.collapseCost = collapseCost;
          v.minCost = collapseCost;
          v.totalCost = 0;
          v.costCount = 0;
        }

        v.costCount++;
        v.totalCost += collapseCost;

        if (collapseCost < v.minCost) {
          v.collapseNeighbor = v.neighbors[i];
          v.minCost = collapseCost;
        }
      }

      // we average the cost of collapsing at this vertex
      v.collapseCost = v.totalCost / v.costCount;
      // v.collapseCost = v.minCost;
    }

    function removeVertex(v, vertices) {
      console.assert(v.faces.length === 0);

      while (v.neighbors.length) {
        const n = v.neighbors.pop();
        removeFromArray(n.neighbors, v);
      }

      removeFromArray(vertices, v);
    }

    function removeFace(f, faces) {
      removeFromArray(faces, f);

      if (f.v1) removeFromArray(f.v1.faces, f);
      if (f.v2) removeFromArray(f.v2.faces, f);
      if (f.v3) removeFromArray(f.v3.faces, f);

      // TODO optimize this!
      const vs = [f.v1, f.v2, f.v3];

      for (let i = 0; i < 3; i++) {
        const v1 = vs[i];
        const v2 = vs[(i + 1) % 3];

        if (!v1 || !v2) continue;

        v1.removeIfNonNeighbor(v2);
        v2.removeIfNonNeighbor(v1);
      }
    }

    function collapse(vertices, faces, u, v) {
      // Collapse the edge uv by moving vertex u onto v

      if (!v) {
        // u is a vertex all by itself so just delete it..
        removeVertex(u, vertices);
        return;
      }

      if (v.uv) {
        u.uv.copy(v.uv);
      }

      if (v.normal) {
        v.normal.add(u.normal).normalize();
      }

      if (v.tangent) {
        v.tangent.add(u.tangent).normalize();
      }

      const tmpVertices = [];

      for (let i = 0; i < u.neighbors.length; i++) {
        tmpVertices.push(u.neighbors[i]);
      }

      // delete triangles on edge uv:
      for (let i = u.faces.length - 1; i >= 0; i--) {
        if (u.faces[i] && u.faces[i].hasVertex(v)) {
          removeFace(u.faces[i], faces);
        }
      }

      // update remaining triangles to have v instead of u
      for (let i = u.faces.length - 1; i >= 0; i--) {
        u.faces[i].replaceVertex(u, v);
      }

      removeVertex(u, vertices);

      // recompute the edge collapse costs in neighborhood
      for (let i = 0; i < tmpVertices.length; i++) {
        computeEdgeCostAtVertex(tmpVertices[i]);
      }
    }

    function minimumCostEdge(vertices) {
      // O(n * n) approach. TODO optimize this

      let least = vertices[0];

      for (let i = 0; i < vertices.length; i++) {
        if (vertices[i].collapseCost < least.collapseCost) {
          least = vertices[i];
        }
      }

      return least;
    }

    // we use a triangle class to represent structure of face slightly differently

    class Triangle {
      constructor(v1, v2, v3, a, b, c) {
        this.a = a;
        this.b = b;
        this.c = c;

        this.v1 = v1;
        this.v2 = v2;
        this.v3 = v3;

        this.normal = new Vector3();

        this.computeNormal();

        v1.faces.push(this);
        v1.addUniqueNeighbor(v2);
        v1.addUniqueNeighbor(v3);

        v2.faces.push(this);
        v2.addUniqueNeighbor(v1);
        v2.addUniqueNeighbor(v3);

        v3.faces.push(this);
        v3.addUniqueNeighbor(v1);
        v3.addUniqueNeighbor(v2);
      }

      computeNormal() {
        const vA = this.v1.position;
        const vB = this.v2.position;
        const vC = this.v3.position;

        _cb.subVectors(vC, vB);
        _ab.subVectors(vA, vB);
        _cb.cross(_ab).normalize();

        this.normal.copy(_cb);
      }

      hasVertex(v) {
        return v === this.v1 || v === this.v2 || v === this.v3;
      }

      replaceVertex(oldv, newv) {
        if (oldv === this.v1) this.v1 = newv;
        else if (oldv === this.v2) this.v2 = newv;
        else if (oldv === this.v3) this.v3 = newv;

        removeFromArray(oldv.faces, this);
        newv.faces.push(this);

        oldv.removeIfNonNeighbor(this.v1);
        this.v1.removeIfNonNeighbor(oldv);

        oldv.removeIfNonNeighbor(this.v2);
        this.v2.removeIfNonNeighbor(oldv);

        oldv.removeIfNonNeighbor(this.v3);
        this.v3.removeIfNonNeighbor(oldv);

        this.v1.addUniqueNeighbor(this.v2);
        this.v1.addUniqueNeighbor(this.v3);

        this.v2.addUniqueNeighbor(this.v1);
        this.v2.addUniqueNeighbor(this.v3);

        this.v3.addUniqueNeighbor(this.v1);
        this.v3.addUniqueNeighbor(this.v2);

        this.computeNormal();
      }
    }

    class Vertex {
      constructor(v, uv, normal, tangent, color) {
        this.position = v;
        this.uv = uv;
        this.normal = normal;
        this.tangent = tangent;
        this.color = color;

        this.id = -1; // external use position in vertices list (for e.g. face generation)

        this.faces = []; // faces vertex is connected
        this.neighbors = []; // neighbouring vertices aka "adjacentVertices"

        // these will be computed in computeEdgeCostAtVertex()
        this.collapseCost = 0; // cost of collapsing this vertex, the less the better. aka objdist
        this.collapseNeighbor = null; // best candidate for collapsing
      }

      addUniqueNeighbor(vertex) {
        pushIfUnique(this.neighbors, vertex);
      }

      removeIfNonNeighbor(n) {
        const neighbors = this.neighbors;
        const faces = this.faces;

        const offset = neighbors.indexOf(n);

        if (offset === -1) return;

        for (let i = 0; i < faces.length; i++) {
          if (faces[i].hasVertex(n)) return;
        }

        neighbors.splice(offset, 1);
      }
    }

    window.SimplifyModifier = SimplifyModifier;
  })();

  class RGBELoader extends DataTextureLoader {
    constructor(manager) {
      super(manager);

      this.type = HalfFloatType;
    }

    parse(buffer) {
      // adapted from http://www.graphics.cornell.edu/~bjw/rgbe.html

      const /* default error routine.  change this to change error handling */
        rgbe_read_error = 1,
        rgbe_write_error = 2,
        rgbe_format_error = 3,
        rgbe_memory_error = 4,
        rgbe_error = function (rgbe_error_code, msg) {
          switch (rgbe_error_code) {
            case rgbe_read_error:
              throw new Error("THREE.RGBELoader: Read Error: " + (msg || ""));
            case rgbe_write_error:
              throw new Error("THREE.RGBELoader: Write Error: " + (msg || ""));
            case rgbe_format_error:
              throw new Error(
                "THREE.RGBELoader: Bad File Format: " + (msg || "")
              );
            default:
            case rgbe_memory_error:
              throw new Error("THREE.RGBELoader: Memory Error: " + (msg || ""));
          }
        },
        /* offsets to red, green, and blue components in a data (float) pixel */
        //RGBE_DATA_RED = 0,
        //RGBE_DATA_GREEN = 1,
        //RGBE_DATA_BLUE = 2,

        /* number of floats per pixel, use 4 since stored in rgba image format */
        //RGBE_DATA_SIZE = 4,

        /* flags indicating which fields in an rgbe_header_info are valid */
        RGBE_VALID_PROGRAMTYPE = 1,
        RGBE_VALID_FORMAT = 2,
        RGBE_VALID_DIMENSIONS = 4,
        NEWLINE = "\n",
        fgets = function (buffer, lineLimit, consume) {
          const chunkSize = 128;

          lineLimit = !lineLimit ? 1024 : lineLimit;
          let p = buffer.pos,
            i = -1,
            len = 0,
            s = "",
            chunk = String.fromCharCode.apply(
              null,
              new Uint16Array(buffer.subarray(p, p + chunkSize))
            );

          while (
            0 > (i = chunk.indexOf(NEWLINE)) &&
            len < lineLimit &&
            p < buffer.byteLength
          ) {
            s += chunk;
            len += chunk.length;
            p += chunkSize;
            chunk += String.fromCharCode.apply(
              null,
              new Uint16Array(buffer.subarray(p, p + chunkSize))
            );
          }

          if (-1 < i) {
            /*for (i=l-1; i>=0; i--) {
                byteCode = m.charCodeAt(i);
                if (byteCode > 0x7f && byteCode <= 0x7ff) byteLen++;
                else if (byteCode > 0x7ff && byteCode <= 0xffff) byteLen += 2;
                if (byteCode >= 0xDC00 && byteCode <= 0xDFFF) i--; //trail surrogate
            }*/
            if (false !== consume) buffer.pos += len + i + 1;
            return s + chunk.slice(0, i);
          }

          return false;
        },
        /* minimal header reading.  modify if you want to parse more information */
        RGBE_ReadHeader = function (buffer) {
          // regexes to parse header info fields
          const magic_token_re = /^#\?(\S+)/,
            gamma_re = /^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,
            exposure_re = /^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,
            format_re = /^\s*FORMAT=(\S+)\s*$/,
            dimensions_re = /^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,
            // RGBE format header struct
            header = {
              valid: 0 /* indicate which fields are valid */,

              string: "" /* the actual header string */,

              comments: "" /* comments found in header */,

              programtype:
                "RGBE" /* listed at beginning of file to identify it after "#?". defaults to "RGBE" */,

              format: "" /* RGBE format, default 32-bit_rle_rgbe */,

              gamma: 1.0 /* image has already been gamma corrected with given gamma. defaults to 1.0 (no correction) */,

              exposure: 1.0 /* a value of 1.0 in an image corresponds to <exposure> watts/steradian/m^2. defaults to 1.0 */,

              width: 0,
              height: 0 /* image dimensions, width/height */,
            };

          let line, match;

          if (buffer.pos >= buffer.byteLength || !(line = fgets(buffer))) {
            rgbe_error(rgbe_read_error, "no header found");
          }

          /* if you want to require the magic token then uncomment the next line */
          if (!(match = line.match(magic_token_re))) {
            rgbe_error(rgbe_format_error, "bad initial token");
          }

          header.valid |= RGBE_VALID_PROGRAMTYPE;
          header.programtype = match[1];
          header.string += line + "\n";

          while (true) {
            line = fgets(buffer);
            if (false === line) break;
            header.string += line + "\n";

            if ("#" === line.charAt(0)) {
              header.comments += line + "\n";
              continue; // comment line
            }

            if ((match = line.match(gamma_re))) {
              header.gamma = parseFloat(match[1]);
            }

            if ((match = line.match(exposure_re))) {
              header.exposure = parseFloat(match[1]);
            }

            if ((match = line.match(format_re))) {
              header.valid |= RGBE_VALID_FORMAT;
              header.format = match[1]; //'32-bit_rle_rgbe';
            }

            if ((match = line.match(dimensions_re))) {
              header.valid |= RGBE_VALID_DIMENSIONS;
              header.height = parseInt(match[1], 10);
              header.width = parseInt(match[2], 10);
            }

            if (
              header.valid & RGBE_VALID_FORMAT &&
              header.valid & RGBE_VALID_DIMENSIONS
            )
              break;
          }

          if (!(header.valid & RGBE_VALID_FORMAT)) {
            rgbe_error(rgbe_format_error, "missing format specifier");
          }

          if (!(header.valid & RGBE_VALID_DIMENSIONS)) {
            rgbe_error(rgbe_format_error, "missing image size specifier");
          }

          return header;
        },
        RGBE_ReadPixels_RLE = function (buffer, w, h) {
          const scanline_width = w;

          if (
            // run length encoding is not allowed so read flat
            scanline_width < 8 ||
            scanline_width > 0x7fff ||
            // this file is not run length encoded
            2 !== buffer[0] ||
            2 !== buffer[1] ||
            buffer[2] & 0x80
          ) {
            // return the flat buffer
            return new Uint8Array(buffer);
          }

          if (scanline_width !== ((buffer[2] << 8) | buffer[3])) {
            rgbe_error(rgbe_format_error, "wrong scanline width");
          }

          const data_rgba = new Uint8Array(4 * w * h);

          if (!data_rgba.length) {
            rgbe_error(rgbe_memory_error, "unable to allocate buffer space");
          }

          let offset = 0,
            pos = 0;

          const ptr_end = 4 * scanline_width;
          const rgbeStart = new Uint8Array(4);
          const scanline_buffer = new Uint8Array(ptr_end);
          let num_scanlines = h;

          // read in each successive scanline
          while (num_scanlines > 0 && pos < buffer.byteLength) {
            if (pos + 4 > buffer.byteLength) {
              rgbe_error(rgbe_read_error);
            }

            rgbeStart[0] = buffer[pos++];
            rgbeStart[1] = buffer[pos++];
            rgbeStart[2] = buffer[pos++];
            rgbeStart[3] = buffer[pos++];

            if (
              2 != rgbeStart[0] ||
              2 != rgbeStart[1] ||
              ((rgbeStart[2] << 8) | rgbeStart[3]) != scanline_width
            ) {
              rgbe_error(rgbe_format_error, "bad rgbe scanline format");
            }

            // read each of the four channels for the scanline into the buffer
            // first red, then green, then blue, then exponent
            let ptr = 0,
              count;

            while (ptr < ptr_end && pos < buffer.byteLength) {
              count = buffer[pos++];
              const isEncodedRun = count > 128;
              if (isEncodedRun) count -= 128;

              if (0 === count || ptr + count > ptr_end) {
                rgbe_error(rgbe_format_error, "bad scanline data");
              }

              if (isEncodedRun) {
                // a (encoded) run of the same value
                const byteValue = buffer[pos++];
                for (let i = 0; i < count; i++) {
                  scanline_buffer[ptr++] = byteValue;
                }
                //ptr += count;
              } else {
                // a literal-run
                scanline_buffer.set(buffer.subarray(pos, pos + count), ptr);
                ptr += count;
                pos += count;
              }
            }

            // now convert data from buffer into rgba
            // first red, then green, then blue, then exponent (alpha)
            const l = scanline_width; //scanline_buffer.byteLength;
            for (let i = 0; i < l; i++) {
              let off = 0;
              data_rgba[offset] = scanline_buffer[i + off];
              off += scanline_width; //1;
              data_rgba[offset + 1] = scanline_buffer[i + off];
              off += scanline_width; //1;
              data_rgba[offset + 2] = scanline_buffer[i + off];
              off += scanline_width; //1;
              data_rgba[offset + 3] = scanline_buffer[i + off];
              offset += 4;
            }

            num_scanlines--;
          }

          return data_rgba;
        };

      const RGBEByteToRGBFloat = function (
        sourceArray,
        sourceOffset,
        destArray,
        destOffset
      ) {
        const e = sourceArray[sourceOffset + 3];
        const scale = Math.pow(2.0, e - 128.0) / 255.0;

        destArray[destOffset + 0] = sourceArray[sourceOffset + 0] * scale;
        destArray[destOffset + 1] = sourceArray[sourceOffset + 1] * scale;
        destArray[destOffset + 2] = sourceArray[sourceOffset + 2] * scale;
        destArray[destOffset + 3] = 1;
      };

      const RGBEByteToRGBHalf = function (
        sourceArray,
        sourceOffset,
        destArray,
        destOffset
      ) {
        const e = sourceArray[sourceOffset + 3];
        const scale = Math.pow(2.0, e - 128.0) / 255.0;

        // clamping to 65504, the maximum representable value in float16
        destArray[destOffset + 0] = DataUtils.toHalfFloat(
          Math.min(sourceArray[sourceOffset + 0] * scale, 65504)
        );
        destArray[destOffset + 1] = DataUtils.toHalfFloat(
          Math.min(sourceArray[sourceOffset + 1] * scale, 65504)
        );
        destArray[destOffset + 2] = DataUtils.toHalfFloat(
          Math.min(sourceArray[sourceOffset + 2] * scale, 65504)
        );
        destArray[destOffset + 3] = DataUtils.toHalfFloat(1);
      };

      const byteArray = new Uint8Array(buffer);
      byteArray.pos = 0;
      const rgbe_header_info = RGBE_ReadHeader(byteArray);

      const w = rgbe_header_info.width,
        h = rgbe_header_info.height,
        image_rgba_data = RGBE_ReadPixels_RLE(
          byteArray.subarray(byteArray.pos),
          w,
          h
        );

      let data, type;
      let numElements;

      switch (this.type) {
        case FloatType:
          numElements = image_rgba_data.length / 4;
          const floatArray = new Float32Array(numElements * 4);

          for (let j = 0; j < numElements; j++) {
            RGBEByteToRGBFloat(image_rgba_data, j * 4, floatArray, j * 4);
          }

          data = floatArray;
          type = FloatType;
          break;

        case HalfFloatType:
          numElements = image_rgba_data.length / 4;
          const halfArray = new Uint16Array(numElements * 4);

          for (let j = 0; j < numElements; j++) {
            RGBEByteToRGBHalf(image_rgba_data, j * 4, halfArray, j * 4);
          }

          data = halfArray;
          type = HalfFloatType;
          break;

        default:
          throw new Error("THREE.RGBELoader: Unsupported type: " + this.type);
          break;
      }

      return {
        width: w,
        height: h,
        data: data,
        header: rgbe_header_info.string,
        gamma: rgbe_header_info.gamma,
        exposure: rgbe_header_info.exposure,
        type: type,
      };
    }

    setDataType(value) {
      this.type = value;
      return this;
    }

    load(url, onLoad, onProgress, onError) {
      function onLoadCallback(texture, texData) {
        switch (texture.type) {
          case FloatType:
          case HalfFloatType:
            texture.colorSpace = LinearSRGBColorSpace;
            texture.minFilter = LinearFilter;
            texture.magFilter = LinearFilter;
            texture.generateMipmaps = false;
            texture.flipY = true;

            break;
        }

        if (onLoad) onLoad(texture, texData);
      }

      return super.load(url, onLoadCallback, onProgress, onError);
    }
  }

  window.TextureLoaderWithProgress = TextureLoaderWithProgress;
  window.RGBELoader = RGBELoader;
})();
