export const vertexShader = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
export const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec4 manualA;
uniform float manualS;
uniform vec4 presetA;
uniform float presetS;
uniform float intensity;
uniform bool before;
uniform bool flattenWhite;
in vec2 uv;
out vec4 outputColor;
// Standard sRGB transfer functions keep all grading in linear light.
vec3 decode(vec3 c) {
  return mix(pow((c + .055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(.04045)));
}
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - .055, 12.92 * c, lessThanEqual(c, vec3(.0031308)));
}
vec3 adjust(vec3 c, vec4 a, float s) {
  c *= exp2(a.x);
  c *= exp2(vec3(.25*a.z + .125*a.w, -.25*a.w, -.25*a.z + .125*a.w));
  // Contrast pivots at scene-linear middle gray; saturation uses Rec.709 luminance.
  c = .18 + (c - .18) * exp2(a.y);
  return mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, 1.0+s);
}
void main() {
  vec4 pixel = texture(source, uv);
  vec3 linear = decode(pixel.rgb);
  // Blend the preset against the unchanged source first, then apply manual edits.
  if (!before) linear = adjust(mix(linear, adjust(linear, presetA, presetS), intensity), manualA, manualS);
  if (flattenWhite) linear = linear * pixel.a + vec3(1.0 - pixel.a);
  outputColor = vec4(encode(linear), flattenWhite ? 1.0 : pixel.a);
}`
