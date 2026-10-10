import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Ambient occlusion worked out at a fraction of the screen's resolution (cheaper; it's soft anyway). */
class ScaledGTAOPass extends GTAOPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private scale: number,
  ) {
    super(scene, camera, 512, 512);
    this.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.blendIntensity = 0.85;
  }

  override setSize(w: number, h: number) {
    super.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
  }
}

/**
 * High / Ultra post-processing. The world is drawn into a linear HDR buffer (with MSAA), darkened in its
 * creases by ambient occlusion, then the viewmodel goes on top (over a cleared depth buffer), then bloom
 * (only the brightest highlights: sun, muzzle flashes, explosions, lasers), neutral tone mapping + sRGB,
 * and optionally SMAA on top.
 */
export class PostFx {
  private composer: EffectComposer;
  private vm: RenderPass;
  private passes: { dispose(): void }[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    vmScene: THREE.Scene,
    vmCamera: THREE.Camera,
    o: { msaa: boolean; smaa: boolean; ao: number },
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // float colour buffers keep highlights above 1 for the bloom; 8-bit is the (rare) fallback
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: o.msaa ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    const world = new RenderPass(scene, camera);
    this.vm = new RenderPass(vmScene, vmCamera);
    this.vm.clear = false;
    this.vm.clearDepth = true;
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 1.05);
    const output = new OutputPass();
    this.composer.addPass(world);
    if (o.ao > 0) {
      const ao = new ScaledGTAOPass(scene, camera, o.ao);
      this.composer.addPass(ao);
      this.passes.push(ao);
    }
    this.composer.addPass(this.vm);
    this.composer.addPass(bloom);
    this.composer.addPass(output);
    this.passes.push(world, this.vm, bloom, output);
    if (o.smaa) {
      const smaa = new SMAAPass();
      this.composer.addPass(smaa);
      this.passes.push(smaa);
    }
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    const css = renderer.getSize(new THREE.Vector2());
    this.setSize(css.x, css.y, renderer.getPixelRatio());
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
  }

  render(dt: number, viewmodel: boolean) {
    this.vm.enabled = viewmodel;
    this.composer.render(dt);
  }

  dispose() {
    for (const p of this.passes) p.dispose();
    this.composer.dispose();
    this.renderer.toneMapping = THREE.NoToneMapping;
  }
}
