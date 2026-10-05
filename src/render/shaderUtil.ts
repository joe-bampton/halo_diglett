/**
 * Our hand-written shaders work out colours as they should look on screen (sRGB). three.js gives every
 * ShaderMaterial `linearToOutputTexel()`: sRGB encoding when drawing straight to the canvas, nothing when
 * drawing into the (linear) post-processing buffer. Decoding first, then that: the canvas gets exactly the
 * colour the shader wrote (checked pixel for pixel), and post-processing gets the linear value it expects.
 * Negative values are clamped first: the decode's pow() would turn them into NaN.
 */
export const DISPLAY_COLOR = /* glsl */ `
vec4 displayColor(vec4 c) { return linearToOutputTexel(sRGBTransferEOTF(max(c, vec4(0.0)))); }
`;
