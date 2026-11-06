var e={antialias:!1,depth:!1,stencil:!1,alpha:!1,preserveDrawingBuffer:!1},t=`ANGLE_instanced_arrays.EXT_blend_minmax.EXT_color_buffer_float.EXT_color_buffer_half_float.EXT_disjoint_timer_query.EXT_disjoint_timer_query_webgl2.EXT_float_blend.EXT_frag_depth.EXT_shader_texture_lod.EXT_sRGB.EXT_texture_compression_bptc.EXT_texture_compression_rgtc.EXT_texture_filter_anisotropic.KHR_parallel_shader_compile.OES_element_index_uint.OES_fbo_render_mipmap.OES_standard_derivatives.OES_texture_float.OES_texture_float_linear.OES_texture_half_float.OES_texture_half_float_linear.OES_vertex_array_object.OVR_multiview2.WEBGL_color_buffer_float.WEBGL_compressed_texture_astc.WEBGL_compressed_texture_etc.WEBGL_compressed_texture_etc1.WEBGL_compressed_texture_pvrtc.WEBGL_compressed_texture_s3tc.WEBGL_compressed_texture_s3tc_srgb.WEBGL_debug_renderer_info.WEBGL_debug_shaders.WEBGL_depth_texture.WEBGL_draw_buffers.WEBGL_lose_context`.split(`.`),n=2e4;function r(e){let t=``;for(let n of e.split(`
`)){let e=n.endsWith(`\r`)?n.slice(0,-1):n,r=e.indexOf(`//`),i=(r>=0?e.slice(0,r):e).trim();i&&(t+=`${i}\n`)}return t}var i=!1;function a(){if(i)return;i=!0;let a=null;try{a=document.createElement(`canvas`).getContext(`webgl2`,e)}catch{return}if(!a)return;let o=a,s=o.getExtension(`KHR_parallel_shader_compile`),c=()=>o.getExtension(`WEBGL_lose_context`)?.loseContext();if(!s){c();return}for(let e of t)o.getExtension(e);let l=r(`#version 300 es
// One triangle that covers the viewport; the fragment shader does all the mapping.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`),u=[`#version 300 es
// BEZEL main pass: every output pixel is computed straight from the source texture in one pass:
// map output px to stored image px, sample, develop() (Lightroom's Basic panel), encode. The Plan
// block layout is defined in crates/bezel-core/src/plan.rs (a Rust test checks the member order).
//
// develop() follows LightCraft's finish stage for rendered (display-referred) photos
// (https://github.com/storytold/lightcraft, MIT): white balance, exposure, Highlights/Shadows on an
// edge-aware base, the display tone curve (Contrast, Whites, Blacks), highlight desaturation,
// Vibrance and Saturation in OkLCh, then a gamut map. Contrast, Whites, Blacks and Shadows are much
// stronger than LightCraft's display curves (whose Blacks at -100 took an sRGB 48 grey only to 43).
// The Effects are LightCraft's too: Dehaze (dark channel and airlight) after exposure, Clarity and
// Texture as log-luminance detail gains beside Highlights/Shadows, the post-crop vignette last.
// Sharpening is a gain of the same kind, from an unsharp mask one output pixel wide.
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

layout(std140) uniform Plan {
  vec4 mapX;
  vec4 mapY;
  vec4 outInfo;
  vec4 imgInfo;
  vec4 bg;
  vec4 view;
  vec4 wb0;
  vec4 wb1;
  vec4 wb2;
  vec4 tone;
  vec4 tone2;
  vec4 mode;
  vec4 clip;
  vec4 fx;
  vec4 vig;
  vec4 hazeAir;
  vec4 vigX;
  vec4 vigY;
  vec4 fx2;
  vec4 fx3;
  vec4 nr;
  vec4 nr2;
  vec4 tm0;
  vec4 tm1;
  vec4 tm2;
  vec4 tm3;
  vec4 tm4;
  vec4 wbr;
  vec4 ex0;
  vec4 ex1;
  vec4 shp;
  vec4 lk0;
  vec4 raw0;
  vec4 hsv0;
  vec4 hsv1;
  vec4 hsv2;
};

// The look's program (see crates/bezel-core/src/look.rs \`program\`): what runs on each pixel, in order.
layout(std140) uniform Look {
  vec4 lp[128];
};

// Redactions, in stored px (see crates/bezel-core/src/plan.rs \`redact_block\`): three vec4s each.
layout(std140) uniform Redact {
  vec4 rinfo;
  vec4 rdata[96];
};

// Magnifiers, in stored px (see \`inset_block\` in plan.rs): two vec4s each.
layout(std140) uniform Inset {
  vec4 iinfo;
  vec4 idata[18];
};

// Panels over the photo (see \`glass_block\` in plan.rs): count and blur radius (device px), then two
// vec4s each: its rect in output px, and its colour (linear) with how much of it covers the photo.
layout(std140) uniform Glass {
  vec4 ginfo;
  vec4 gdata[8];
};

uniform sampler2D uSrc;  // SRGB8_ALPHA8 (a raw's: RGBA16F, its camera's RGB): samples come back in linear light
uniform sampler2D uClarity; // R16F, the photo 256 px long: Clarity below 0's blurred lightness
uniform sampler2D uCurve; // RGBA32F, rows of 64: the tone curve's tables, the Color Mixer's, the vignette's, the base curve's
uniform sampler2D uTexA; // RGBA16F, half size: Texture's base, the luma's and first colour difference's a, b
uniform sampler2D uDehaze; // R16F, about 1024 px long: Dehaze's transmission (0.2..1)
uniform sampler2D uTone; // RG32F, a quarter size: Highlights/Shadows' mask and its gray log image
uniform sampler2D uTexB; // RG16F, half size: Texture's base, the second colour difference's a, b
uniform sampler2D uShp; // RGBA16F, the render's size: with Sharpening, the render up to it (see main)
uniform sampler2D uShK; // R32F: Sharpening's factor for each px's encoded channels
uniform highp sampler3D uLook; // RGBA32F: the look's 3D LUT (red along x)
uniform sampler2D uLookShaper; // RGBA32F, rows of 1024: the look's 1D LUT
uniform sampler2D uHsv; // RGBA32F: a raw's profile's hue/saturation map's entries, then its look table's

layout(location = 0) out vec4 fragColor;
// with Sharpening, the first of the render's two phases: its luma (gamma 1.8)
layout(location = 1) out vec4 fragLuma;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722); // linear sRGB
const float GREY = 0.18;

float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Log luminance relative to grey.
float logLum(vec3 c) {
  return log2(max(dot(c, LUMA), 1e-7) / GREY);
}

// Log luminance of the source at \`uv\`, at mip level \`lod\` (transparent pixels on white, as in main).
float logLumAt(vec2 uv, float lod) {
  vec4 s = textureLod(uSrc, uv, lod);
  return logLum(mix(vec3(1.0), s.rgb, s.a));
}

float darkest(vec3 c) {
  return min(c.r, min(c.g, c.b));
}

// Lightroom's tone and colour, as Camera Raw (its process version 2012 on) does them, read from its
// code, in its order: its exposure stage (positive Exposure, Whites, Blacks), Saturation, its HSL
// stage (Vibrance, then the Color Mixer), then Contrast with the tone curve (one curve with the
// parametric regions and the point curve, on sRGB-encoded values). Most apply to the brightest and
// the darkest channel, the middle one following by its place between them, so hue holds (the DNG
// SDK's RGB tone).

// The pixel with its brightest and darkest channel at \`hi\` and \`lo\`, the middle by its ratio.
vec3 byMaxMin(vec3 c, float hi, float lo) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  if (mx - mn < 1e-9) return vec3(hi);
  return lo + (c - mn) / (mx - mn) * (hi - lo);
}

// A channel past white brings the others down with it, keeping hue.
vec3 clipHue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  return mx <= 1.0 ? c : byMaxMin(c, 1.0, min(min(c.r, min(c.g, c.b)), 1.0));
}

// Positive Exposure never clips: in gamma 2.2 it is a gain (of at most 2 stops a piece) below encoded
// 0.5, easing into white above it by a cubic from slope g to slope m.
float rolloffPiece(float u, float s) {
  float g = exp2(s / 2.2), k = 0.5 / g, w = 1.0 - k, m = max(0.1, 1.0 / (12.0 * (g - 1.0) + 1.0));
  if (u < k) return g * u;
  float t = (u - k) / w;
  return (1.0 - t) * (1.0 - t) * (0.5 + t + w * g * t) + t * t * (3.0 - 2.0 * t - w * m * (1.0 - t));
}

float rolloff(float x, float stops) {
  float u = pow(clamp(x, 0.0, 1.0), 1.0 / 2.2);
  float s = stops;
  for (int i = 0; i < 4 && s > 1e-6; i++) {
    float p = min(s, 2.0);
    u = rolloffPiece(u, p);
    s -= p;
  }
  return pow(u, 2.2);
}

// Its weighting of a pixel's lightness for Whites and Blacks.
float wbLuma(vec3 c) {
  return (c.r + 2.0 * c.g + c.b) * 0.25;
}

// Camera Raw carries the photo in linear ProPhoto RGB (D50); its tone and colour stages work there.
// From linear sRGB and back, with Camera Raw's own matrices (Adobe's D50 sRGB and ProPhoto, each
// scaled to the D50 white).
const mat3 TO_PROPHOTO = mat3(
  vec3(0.52929932, 0.098412857, 0.016846443), vec3(0.33005076, 0.8734845, 0.11768271), vec3(0.14064992, 0.028102647, 0.86547085));
const mat3 FROM_PROPHOTO = mat3(
  vec3(2.0342895, -0.22892475, -0.0084694439), vec3(-0.72730815, 1.2317166, -0.153326), vec3(-0.30698131, -0.0027918302, 1.1617954));
// ProPhoto's luminance (Camera Raw's Saturation uses 295/1024 and 729/1024)
const vec3 PP_LUMA = vec3(0.2880859, 0.7119141, 0.0);

// Saturation (\`s\` in -1..1): the colour scaled about its luminance.
vec3 saturate(vec3 c, float s) {
  float y = dot(c, PP_LUMA);
  return y + (1.0 + s) * (c - y);
}

// Camera Raw's Vibrance (\`v\` in -1..1) on a pixel's darkest and brightest channel \`mn\`, \`mx\` at hue
// \`h\` (sixths of the circle, red at 0): more for muted colour and in the midtones, fading out in the
// darkest px; above 0 it spares skin (hues from magenta to orange, gone by 45 degrees).
void vibrance(inout float mn, inout float mx, float h, float v) {
  if (mx - mn <= 0.0) return;
  float s = (mx - mn) / mx;
  float t = min(16.0 * mx, 1.0), ft = (2.0 - t) * t;
  float e = (1.0 - s) * s;
  float mx2;
  if (v > 0.0) {
    float hh = h + 1.0 < 6.0 ? h + 1.0 : h - 5.0;
    float skin = min(clamp(hh, 0.0, 1.0), clamp(7.0 - 4.0 * hh, 0.0, 1.0));
    float p = (1.0 - s * s) * skin;
    float q = ft * (p * v + 1.0 - p) * v;
    mx2 = ((1.0 - min(mx, 1.0)) * e * (2.0 - e) * q * 0.25 + 1.0) * mx;
    mn = s * mx2 / ((1.0 - mn) * (1.0 - s) * q * (0.8333333 - 0.4047619 * p) - 1.0) + mx2;
  } else {
    float a = -v;
    mx2 = mx * (1.0 - ft * a * (1.0 - min(mx, 1.0)) * e * (2.0 - e));
    mn = mx2 * (1.0 - s * (1.0 - 0.25 * a) * (1.0 - a + ft * a * s * (1.0 + s) * 0.5));
  }
  mx = mx2;
}

// The Color Mixer's tables at hue \`h\` (sixths of the circle): the hue it becomes, its Saturation and
// its Luminance (a degree an entry, between them; rows 64 on of the curve texture).
vec3 mixerAt(float h) {
  float x = clamp(h, 0.0, 6.0) * 60.0;
  int i = min(int(x), 360);
  vec3 a = texelFetch(uCurve, ivec2(i & 63, 64 + (i >> 6)), 0).rgb;
  vec3 b = texelFetch(uCurve, ivec2((i + 1) & 63, 64 + ((i + 1) >> 6)), 0).rgb;
  return mix(a, b, x - float(i));
}

// Camera Raw's HSL stage (its process version 15.4) on a pixel of linear ProPhoto: Vibrance (\`v\`),
// then the Color Mixer (\`mixer\` on). It works on the pixel's hexcone: its hue, and its darkest and
// brightest channel each softened half the way towards the middle one by the square of how far
// the middle one sits from it (so chroma runs round the hues without corners); back to RGB, the
// softening undone and the darkest and brightest clipped into 0..1, the middle one at its place.
vec3 hslStage(vec3 c, float v, bool mixer) {
  c = max(c, 0.0);
  float lo = min(c.r, min(c.g, c.b)), hi = max(c.r, max(c.g, c.b));
  float md = c.r + c.g + c.b - lo - hi;
  if (hi - lo <= 0.0) return min(c, 1.0);
  float f = (md - lo) / (hi - lo);
  float h = max(c.r, min(c.g, c.b)) < max(c.g, c.b) ? 2.0 - f : f;
  h = c.r < min(c.g, c.b) ? 4.0 - h : h;
  h = c.g < c.b ? 6.0 - h : h;
  float mx = hi + (md - hi) * f * f * 0.5;
  float mn = lo + (md - lo) * (1.0 - f) * (1.0 - f) * 0.5;
  float chroma = mx - mn;
  if (v != 0.0) vibrance(mn, mx, h, v);
  if (mixer) {
    vec3 t = mixerAt(h);
    float sat = t.y, lum = t.z;
    h = t.x;
    mn = max(mn, 0.0);
    mx = max(mx, 0.0);
    if (lum != 0.0) {
      // Luminance: the darkest and brightest scaled towards white or black (twice), by less for
      // muted colour
      float a = clamp(chroma, 0.0, 1.0);
      a = a * (2.0 - a);
      a = (2.0 - a) * a;
      float w = (2.0 - a) * a * lum;
      for (int k = 0; k < 2; k++) {
        mn *= 1.0 + w * (1.0 - clamp(mn, 0.0, 1.0));
        mx *= 1.0 + w * (1.0 - clamp(mx, 0.0, 1.0));
      }
    }
    if (sat < 0.0) {
      // less: towards their mean, grey at -100
      float m = (mn + mx) * 0.5;
      mn += (mn - m) * sat;
      mx += (mx - m) * sat;
    } else if (sat > 0.0) {
      // more: the darkest away from the brightest, less for colour already strong, dark or bright
      float r = mx > 0.0 ? (mx - mn) / mx : 0.0;
      float q = min(1.0, mx * 16.0);
      float r2 = r / (1.0 - (1.0 - r) * ((2.0 - q) * q * sat * 0.8333333 * (1.0 - mn)));
      mn = mx - r2 * mx;
    }
  }
  // back to RGB
  if (h > 6.0) h -= 6.0;
  if (h > 6.0) h -= 6.0;
  bool m3 = h > 3.0;
  if (m3) h = 6.0 - h;
  bool m2 = h > 2.0;
  if (m2) h = 4.0 - h;
  bool m1 = h > 1.0;
  if (m1) h = 2.0 - h;
  float f2 = h * h, fm1 = h - 1.0;
  float inv = 1.0 / (f2 - h + 2.0);
  float nlo = clamp(inv * ((f2 * h - f2 + 2.0) * mn - fm1 * fm1 * h * mx), 0.0, 1.0);
  float nhi = clamp(inv * (fm1 * f2 * mn - (f2 * h - 2.0 * f2 + h - 2.0) * mx), 0.0, 1.0);
  vec3 o = vec3(nhi, nlo + (nhi - nlo) * h, nlo);
  if (m1) o.xy = o.yx;
  if (m2) o.xz = o.zx;
  if (m3) o.yz = o.zy;
  return o;
}

// Whites above 0: an expansion towards its clip \`cc\` (squared), past the rolloff's gain \`g\`.
float whiteExpand(float x, float g, float cc) {
  float v = g * x;
  return v * (1.0 + v / cc) / (1.0 + v) / g;
}

// Blacks below 0 on one channel: cut to black at \`b.x\`, then a toe from \`b.y * b.z\` easing into a
// line from \`b.y\` (a quadratic Bezier through (b.y, 0) to the line's middle).
float blackSubtract(float x, vec3 b) {
  float soft = b.y, t0 = b.y * b.z, xe = 0.5 * (1.0 + soft);
  float y = clamp((x - b.x) / (1.0 - b.x), 0.0, 1.0);
  if (y <= t0) return 0.0;
  if (y >= xe) return (y - soft) / (1.0 - soft);
  float a = t0 - 2.0 * soft + xe, bb = 2.0 * (soft - t0), c = t0 - y;
  float t = -2.0 * c / max(bb + sqrt(max(bb * bb - 4.0 * a * c, 0.0)), 1e-20);
  return 0.5 * t * t;
}

// Its exposure stage (\`ex0\`, \`ex1\`: see crates/bezel-core/src/exposure.rs), in linear ProPhoto: the
// gain Whites above 0 takes from Exposure and its expansion, then Exposure's rolloff, on the
// brightest and darkest channel; Whites below 0; Blacks below 0 on each channel; Blacks above 0.
vec3 exposureStage(vec3 c, float wh, float bl) {
  float roll = ex0.y;
  c *= exp2(ex0.x);
  if (ex0.z < 1.0) {
    float g = exp2(roll);
    c = byMaxMin(c, whiteExpand(max(c.r, max(c.g, c.b)), g, ex0.z), whiteExpand(min(c.r, min(c.g, c.b)), g, ex0.z));
  }
  c = clipHue(c);
  if (roll > 0.0) {
    c = byMaxMin(c, rolloff(max(c.r, max(c.g, c.b)), roll), rolloff(min(c.r, min(c.g, c.b)), roll));
  }
  if (wh < 0.0) {
    // white stays white; at -100 a lightness of 0.5 falls to 0.31
    float y = wbLuma(c), s = pow(3.0, -wh);
    c *= y > 1e-9 ? (y - y * y + pow(y, s + 1.0)) / y : 1.0;
  }
  if (ex1.w > 0.5) {
    c = vec3(blackSubtract(c.r, ex1.xyz), blackSubtract(c.g, ex1.xyz), blackSubtract(c.b, ex1.xyz));
  }
  if (bl > 0.0) {
    // the shadows lifted, black itself kept (at +100 the slope there is 1.87)
    float y = wbLuma(c), f = 0.25 * bl, p = min(3.0, 4.0 - 2.0 * f), q = 4.0 * f;
    float l = ((y + exp2(-p)) / (1.0 + exp2(-p))) / ((y + exp2(-p - q)) / (1.0 + exp2(-p - q)));
    c *= y > 1e-9 ? (l * y + (1.0 - l) * y * y) / y : 1.0;
  }
  return min(max(c, 0.0), 1.0);
}

vec3 encodeSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 decodeSrgb(vec3 e) {
  return mix(e / 12.92, pow((e + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), e));
}

// The tone curve's tables at encoded value \`e\`, between their 4096 entries (rows of 64): each
// channel's own curve in r, g, b; the master curve (Contrast, the parametric regions, the point
// curve) in a.
vec4 curveAt(float e) {
  float f = clamp(e, 0.0, 1.0) * 4095.0;
  int i = min(int(f), 4094);
  vec4 a = texelFetch(uCurve, ivec2(i & 63, i >> 6), 0);
  vec4 b = texelFetch(uCurve, ivec2((i + 1) & 63, (i + 1) >> 6), 0);
  return mix(a, b, f - float(i));
}

// Camera Raw's tone curve on a pixel (sRGB-encoded ProPhoto): its master curve hue-preservingly,
// the brightest and darkest channel through it and the middle one kept at its place between them,
// smoothed where two channels cross (the curve is read part way to the middle channel and solved
// back, so the result bends smoothly as a colour turns), then each channel's own curve.
vec3 toneCurve(vec3 e) {
  float lo = min(e.r, min(e.g, e.b)), hi = max(e.r, max(e.g, e.b));
  float md = e.r + e.g + e.b - lo - hi;
  float t = hi > lo ? (md - lo) / (hi - lo) : 0.0;
  float tn = curveAt(lo + 0.5 * (1.0 - t) * (1.0 - t) * (md - lo)).a;
  float tx = curveAt(hi + 0.5 * t * t * (md - hi)).a;
  float t2 = t * t;
  float d = 1.0 / (2.0 - t + t2);
  float nlo = clamp(d * (tn * (2.0 - t2 + t2 * t) - tx * (t - 1.0) * (t - 1.0) * t), 0.0, 1.0);
  float nhi = clamp(d * (tn * t2 * (t - 1.0) - tx * (t2 * t - 2.0 * t2 + t - 2.0)), 0.0, 1.0);
  e = hi > lo ? nlo + (e - lo) / (hi - lo) * (nhi - nlo) : vec3(nlo);
  return vec3(curveAt(e.r).r, curveAt(e.g).g, curveAt(e.b).b);
}

// A raw's profile's hue/saturation table on linear \`c\` (crates/bezel-core/src/hsvtable.rs, Camera
// Raw's own kernel): \`dims\` its hue, saturation and value divisions and whether its value axis is
// sRGB-encoded, its entries from row \`row0\` of \`uHsv\` (a column a hue, a row a saturation within each
// value), \`top\` where the light tops out (Camera Raw's 1, on the light's own scale). HSV the DNG
// SDK's (hue in sixths, value the largest channel), the grid interpolated linearly with the hue axis
// cyclic (each place truncated, its fraction not held); a hue shift in degrees, the saturation
// scaled (to 1 at most), the value scaled (to the top at most).
vec3 hsvEntry(int h, int s, int v, int sats, int row0) {
  return texelFetch(uHsv, ivec2(h, row0 + v * sats + s), 0).rgb;
}

vec3 hsvTable(vec3 c, vec4 dims, int row0, float top) {
  int hues = int(dims.x), sats = int(dims.y), vals = int(dims.z);
  float v = max(c.r, max(c.g, c.b));
  float gap = v - min(c.r, min(c.g, c.b));
  float h = 0.0, s = 0.0;
  if (gap > 0.0) {
    if (c.r == v) {
      h = (c.g - c.b) / gap;
      if (h < 0.0) h += 6.0;
    } else if (c.g == v) {
      h = 2.0 + (c.b - c.r) / gap;
    } else {
      h = 4.0 + (c.r - c.g) / gap;
    }
    s = gap / v;
  }
  float vv = min(v / top, 1.0);
  if (dims.w > 0.5) vv = encodeSrgb(vec3(vv)).r;
  float hs = h * float(hues) / 6.0;
  float ss = s * float(sats - 1);
  int h0 = clamp(int(hs), 0, hues - 1);
  int h1 = h0 + 1 >= hues ? 0 : h0 + 1;
  float hf = hs - float(h0);
  int s0 = clamp(int(ss), 0, sats - 2);
  float sf = ss - float(s0);
  int v0 = 0, v1 = 0;
  float vf = 0.0;
  if (vals > 1) {
    float vs = vv * float(vals - 1);
    v0 = clamp(int(vs), 0, vals - 2);
    v1 = v0 + 1;
    vf = vs - float(v0);
  }
  vec3 a0 = mix(mix(hsvEntry(h0, s0, v0, sats, row0), hsvEntry(h0, s0 + 1, v0, sats, row0), sf),
                mix(hsvEntry(h1, s0, v0, sats, row0), hsvEntry(h1, s0 + 1, v0, sats, row0), sf), hf);
  // (a table of one value level, as most profiles' are: its one, read once)
  vec3 e = a0;
  if (vals > 1) {
    vec3 a1 = mix(mix(hsvEntry(h0, s0, v1, sats, row0), hsvEntry(h0, s0 + 1, v1, sats, row0), sf),
                  mix(hsvEntry(h1, s0, v1, sats, row0), hsvEntry(h1, s0 + 1, v1, sats, row0), sf), hf);
    e = mix(a0, a1, vf);
  }
  h += e.x * (6.0 / 360.0);
  s = min(max(e.y, 0.0) * s, 1.0);
  v = min(max(e.z, 0.0) * v, top);
  if (s <= 0.0) return vec3(v);
  h = mod(h, 6.0);
  int i = min(int(h), 5);
  float f = h - float(i);
  float p = v * (1.0 - s), q = v * (1.0 - s * f), t = v * (1.0 - s * (1.0 - f));
  if (i == 0) return vec3(v, t, p);
  if (i == 1) return vec3(q, v, p);
  if (i == 2) return vec3(p, v, t);
  if (i == 3) return vec3(p, q, v);
  if (i == 4) return vec3(t, p, v);
  return vec3(v, p, q);
}

// The B&W Mixer's weight at hue \`x\` (degrees; rows 150 on of \`uCurve\`, a degree an entry).
float grayAt(float x) {
  int i = min(int(x), 360);
  float a = texelFetch(uCurve, ivec2(i & 63, 150 + (i >> 6)), 0).r;
  float b = texelFetch(uCurve, ivec2((i + 1) & 63, 150 + ((i + 1) >> 6)), 0).r;
  return (b - a) * (x - float(i)) + a;
}

// The scale a B&W weight below 1/2 mixes on (12 times the value near 0, 1/3 at 1/9, 1 at 1), and
// back.
float grayEncode(float x) {
  return x < 0.0 ? x * 12.0 : x < 0.11111111 ? (x * 3.0) / (x * 6.75 + 0.25) : x * 0.75 + 0.25;
}
float grayDecode(float y) {
  return y < 0.0 ? y * 0.083333336 : y < 0.33333334 ? y / (y * -27.0 + 12.0) : y * 1.3333334 - 0.33333334;
}

// Camera Raw's black and white (the B&W Mixer, its process version 15.4) on a pixel of linear
// ProPhoto: its darkest and brightest channels softened towards the middle one, its gray at its
// hue's weight between them; a weight below 1/2 blends in the same mix on an encoded scale, which
// keeps weights below 0 from going below black. Neutral pixels stay as they are.
vec3 grayStage(vec3 c) {
  float lo = min(c.g, c.b), hi = max(c.g, c.b);
  float f1 = max(c.r, lo);
  bool redLow = c.r < lo, gbHigh = f1 < hi;
  float mn = redLow ? c.r : lo, mx = gbHigh ? hi : f1;
  if (mx == mn) return c;
  float mid = min(hi, f1);
  float f = (mid - mn) / (mx - mn);
  mn += (1.0 - f) * (1.0 - f) * (mid - mn) * 0.5;
  mx += f * f * (mid - mx) * 0.5;
  float h = gbHigh ? 2.0 - f : f;
  h = redLow ? 4.0 - h : h;
  h = c.g < c.b ? 6.0 - h : h;
  float w = grayAt(h * 60.0);
  float a = w < 0.0 ? 0.0 : 1.0;
  if (abs(w) < 0.5) {
    float q = w >= 0.0 ? w - w * w : w * w + w;
    a = q + q + 0.5;
  }
  float y = 0.0;
  if (a < 1.0) {
    float e0 = grayEncode(mn), e1 = grayEncode(mx);
    y = grayDecode((e1 - e0) * w + e0);
  }
  return vec3(clamp(((w * (mx - mn) + mn) - y) * a + y, 0.0, 1.0));
}

// The base-curve stage's curve at linear \`x\` (rows 86 on of \`uCurve\`, 4096 entries over 0..1).
float baseAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 4095.0;
  int i = min(int(f), 4094);
  float a = texelFetch(uCurve, ivec2(i & 63, 86 + (i >> 6)), 0).r;
  float b = texelFetch(uCurve, ivec2((i + 1) & 63, 86 + ((i + 1) >> 6)), 0).r;
  return mix(a, b, f - float(i));
}

// Camera Raw's base-curve stage on linear ProPhoto (see crates/bezel-core/src/rawtone.rs): a negative
// total exposure's first stop, then the profile's base curve (a raw's), through its hue-preserving
// kernel as the tone curve's master (smoothed where channels cross), on linear values.
vec3 baseCurve(vec3 p) {
  p = clamp(p, 0.0, 1.0);
  float lo = min(p.r, min(p.g, p.b)), hi = max(p.r, max(p.g, p.b));
  float md = p.r + p.g + p.b - lo - hi;
  float t = hi > lo ? (md - lo) / (hi - lo) : 0.0;
  float tn = baseAt(lo + 0.5 * (1.0 - t) * (1.0 - t) * (md - lo));
  float tx = baseAt(hi + 0.5 * t * t * (md - hi));
  float t2 = t * t;
  float d = 1.0 / (2.0 - t + t2);
  float nlo = clamp(d * (tn * (2.0 - t2 + t2 * t) - tx * (t - 1.0) * (t - 1.0) * t), 0.0, 1.0);
  float nhi = clamp(d * (tn * t2 * (t - 1.0) - tx * (t2 * t - 2.0 * t2 + t - 2.0)), 0.0, 1.0);
  return hi > lo ? nlo + (p - lo) / (hi - lo) * (nhi - nlo) : vec3(nlo);
}

// The post-crop vignette's radius at stored px \`sp\`, squared (0 at the crop's centre, 1 at its
// corners), Camera Raw's: an ellipse through the corners, rounder with Roundness (a circle at
// +100), or below 0 a rounded rectangle whose corners tighten with it.
float vignetteX(vec2 sp) {
  vec2 o = vec2(dot(vigX.xyz, vec3(sp, 1.0)), dot(vigY.xyz, vec3(sp, 1.0)));
  vec2 size = max(vec2(vigX.w, vigY.w), vec2(1.0));
  vec2 c = o - size * 0.5;
  float r = vig.y, aspect = size.x / size.y;
  if (r >= 0.0) {
    float d = pow(aspect, r), e = sqrt(d * d + 1.0) * 0.5;
    vec2 q = c / vec2(size.x * e / d, size.y * e);
    return clamp(dot(q, q), 0.0, 1.0);
  }
  float iu, iv;
  if (aspect < 1.0) {
    iu = -0.45 * r;
    iv = max(0.0, 0.5 - (0.5 - iu) / aspect);
  } else {
    iv = -0.45 * r;
    iu = max(0.0, 0.5 - (0.5 - iv) * aspect);
  }
  vec2 uv = o / size;
  float u = max(abs(uv.y - 0.5) - iu, 0.0) * (0.5 / (0.5 - iu));
  float v = max(abs(uv.x - 0.5) - iv, 0.0) * (0.5 / (0.5 - iv));
  return clamp(2.0 * (u * u + v * v), 0.0, 1.0);
}

// Its curve at radius squared \`x\` (rows 70 on of the curve texture, 1024 entries).
float vignetteAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 1023.0;
  int i = min(int(f), 1022);
  float a = texelFetch(uCurve, ivec2(i & 63, 70 + (i >> 6)), 0).r;
  float b = texelFetch(uCurve, ivec2((i + 1) & 63, 70 + ((i + 1) >> 6)), 0).r;
  return mix(a, b, f - float(i));
}

// Camera Raw's post-crop vignette (Highlight Priority, Lightroom's default) on a px of linear
// ProPhoto, before Exposure: above 0 a screen towards white; below 0 a darkening that spares
// bright px by Highlights.
vec3 postCropVignette(vec3 p, vec2 sp) {
  float g = vignetteAt(vignetteX(sp));
  if (vig.x >= 0.0) return 1.0 - min((1.0 - p) * g, 1.0);
  if (vig.z <= 0.0) return min(p * g, 1.0);
  float t = clamp((min(max(p.r, max(p.g, p.b)), 1.0) - 0.18) / 0.82, 0.0, 1.0);
  return p * (g + (1.0 - g) * vig.z * t);
}

// Camera Raw's Highlights/Shadows mask at stored-image \`uv\` for a px of log luminance \`g\`: its
// quarter-size mask brought up to the px by a joint bilateral (4 × 4 texels, weighted by distance
// and by how alike their gray log image is to the px, so the mask keeps to the photo's edges).
float toneMaskAt(vec2 uv, float g) {
  ivec2 size = textureSize(uTone, 0);
  vec2 pos = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(pos)) - 1;
  float acc = 0.0, wsum = 0.0;
  // (the distance weight, exp(-dx² - dy²), as its across and down factors: 8 exps, not 16)
  vec2 d0 = pos - vec2(base);
  vec4 wx = exp(-(d0.x - vec4(0.0, 1.0, 2.0, 3.0)) * (d0.x - vec4(0.0, 1.0, 2.0, 3.0)));
  vec4 wy = exp(-(d0.y - vec4(0.0, 1.0, 2.0, 3.0)) * (d0.y - vec4(0.0, 1.0, 2.0, 3.0)));
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 q = clamp(base + ivec2(i, j), ivec2(0), size - 1);
      vec2 t = texelFetch(uTone, q, 0).rg;
      float r = max(1.0 - 0.05 * (t.y - g) * (t.y - g), 0.0);
      float w = wx[i] * wy[j] * max(r * r * r * r, 0.17725);
      acc += w * t.x;
      wsum += w;
    }
  }
  return acc / wsum;
}

// Camera Raw's tone map (Highlights and Shadows) on a px of linear ProPhoto, by the photo's mask
// (see crates/bezel-core/src/tonemap.rs, \`tone_map_px\`, which this mirrors): on log luminance, the
// mask lifting where positive (Shadows) and darkening where negative (Highlights), weighted by where
// the px sits between the photo's darkest, key and brightest, with a global term; brightening fades
// out towards white and darkening towards black; RGB scaled by the change.
vec3 toneMapBy(vec3 p, float m);
vec3 toneMap(vec3 p, vec2 uv) {
  float y = dot(p, vec3(0.3, 0.59, 0.110000014));
  return toneMapBy(p, toneMaskAt(uv, log2(max(y, 0.0) + tm2.z)));
}

// What a covered pixel's Highlights/Shadows go by, set where its cover is made (see \`redact\`,
// \`frosted\`): the mask at its cover's own scale. The mask holds the photo's detail (it keeps to its
// edges), so read under a cover it would draw what's covered back in, its tones turned over.
float coverMask = 0.0;

// The mask's average over the \`size\`-wide square about stored px \`c\` (4 × 4 taps).
float maskOver(vec2 c, float size) {
  ivec2 dims = textureSize(uTone, 0);
  float acc = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
      vec2 uv = (c + o * size) * imgInfo.zw;
      ivec2 q = clamp(ivec2(floor(uv * vec2(dims))), ivec2(0), dims - 1);
      acc += texelFetch(uTone, q, 0).r;
    }
  }
  return acc * 0.0625;
}

// Stored px of cell \`ci\`'s centre, cells \`cell\` wide in the frame at \`o\` turned by \`cs\` (cos, sin).
vec2 cellAt(vec2 o, vec2 cs, vec2 ci, float cell) {
  vec2 qc = (ci + 0.5) * cell;
  return o + vec2(qc.x * cs.x - qc.y * cs.y, qc.x * cs.y + qc.y * cs.x);
}

// The mask smooth across those cells at \`q\` (in their frame): the four nearest cells' averages,
// blended.
float maskCells(vec2 o, vec2 cs, vec2 q, float cell) {
  vec2 g = q / cell - 0.5;
  vec2 g0 = floor(g);
  vec2 f = g - g0;
  float m00 = maskOver(cellAt(o, cs, g0, cell), cell);
  float m10 = maskOver(cellAt(o, cs, g0 + vec2(1.0, 0.0), cell), cell);
  float m01 = maskOver(cellAt(o, cs, g0 + vec2(0.0, 1.0), cell), cell);
  float m11 = maskOver(cellAt(o, cs, g0 + vec2(1.0, 1.0), cell), cell);
  return mix(mix(m00, m10, f.x), mix(m01, m11, f.x), f.y);
}

// The tone map by mask value \`m\`.
vec3 toneMapBy(vec3 p, float m) {
  float eps = tm2.z, e90 = tm2.w;
  float y = dot(p, vec3(0.3, 0.59, 0.110000014));
  float l = log2(max(y, 0.0) + eps);
  float s = tm0.x, h = tm0.y, key = tm0.z, gg = tm0.w;
  float t = clamp(l <= key ? l * tm1.x + tm1.y : l * tm1.z + tm1.w, 0.0, 1.0);
  float d = (l + m - (l <= key ? l * tm3.z + tm3.w : l * tm4.x + tm4.y)) * tm3.y;
  float a8 = pow(1.0 - t, 8.0), b8 = pow(t, 8.0);
  float kk = h < 0.0 && tm3.x > 0.0 ? 1.0 - b8 * tm3.x * 0.5 : 1.0;
  float hh = s > 0.0 ? 1.0 - 0.5 * a8 : 1.0;
  float delta = min(d, 0.0) * (1.0 - b8) + max(d, 0.0) * (1.0 - a8) + (min(m, 0.0) * -h + t * gg * tm2.y) * kk +
                hh * (max(m, 0.0) * s + (1.0 - t) * gg * tm2.x);
  float d2 = 2.0 * delta, lg = log2(eps), fade = 0.0;
  if (delta > 0.0 && l - e90 > -d2) {
    float q = clamp((d2 + l - e90) / d2, 0.0, 1.0);
    fade = q * q * delta;
  } else if (delta < 0.0 && l < lg - d2) {
    float q = clamp((l - (lg - d2)) / d2, 0.0, 1.0);
    fade = q * q * delta;
  }
  float y2 = max(exp2(clamp(l + delta - fade, -120.0, 120.0)) - eps, 0.0);
  return max(p * (y2 / max(y, eps / 128.0)), 0.0);
}

// Camera Raw's white balance (rendered files) on a px of linear ProPhoto: each channel scaled to
// the dimmest channel's lift (the white's own colour then comes out neutral), channels nearing the
// top pulled towards the brighter of the first two so white stays white, then its matrix (Bradford
// from the white to D50, in ProPhoto); Exposure later makes up the lift (\`wbr.z\`).
vec3 whiteBalance(vec3 p) {
  int ia = int(wb0.w), ib = int(wb1.w), ic = int(wb2.w);
  float pa = p[ia], pb = p[ib], pc = p[ic];
  float a = pa, b = pb * wbr.x, c = pc * wbr.y;
  if (wbr.y < 1.0) {
    float wa = max((pa - 0.25) / 0.75, 0.0), wb = max((pb - 0.25) / 0.75, 0.0), wc = max((pc - 0.25) / 0.75, 0.0);
    float mx = max(a, b);
    float a2 = wa * wa * (mx - a) + a;
    float b2 = wb * wb * (mx - b) + b;
    c += (max((a2 + b2) * 0.5, c) - c) * wc * wc;
    a = a2;
    b = b2;
  }
  vec3 v;
  v[ia] = a;
  v[ib] = b;
  v[ic] = c;
  return clamp(vec3(dot(wb0.xyz, v), dot(wb1.xyz, v), dot(wb2.xyz, v)), 0.0, 1.0);
}

// Camera Raw's Clarity below 0 (\`c\`: -1..0) on a px of linear ProPhoto against its mask's blurred
// lightness \`b\`: on a square-root scale, the detail against it scaled down (by up to 72% at -100),
// less in the darkest and brightest.
vec3 clarityNeg(vec3 p, float b, float c) {
  float k = 1.0 + c * 0.5;
  float f = k * (k + 1.0) * (k + 1.0) * 0.25 - 1.0;
  float y = (p.r + 2.0 * p.g + p.b) * 0.25;
  float u = (sqrt(max(y, 0.0) + 0.00390625) - 0.0625) * 1.0644512;
  float ub = (sqrt(max(b, 0.0) + 0.00390625) - 0.0625) * 1.0644512;
  float v = 2.0 * u - 1.0;
  float w = 1.0 - v * v * v * v;
  w = w * w;
  float u2 = clamp(u + w * w * (u - ub) * f, 0.0, 1.0);
  float e = u2 * 0.9394512 + 0.0625;
  return clamp(p * ((e * e - 0.00390625) / max(y, 1.5259022e-5)), 0.0, 1.0);
}

// Camera Raw's Dehaze (\`d\`, the slider: -1..1) on a px of linear ProPhoto with transmission \`t\`:
// above 0 the airlight's veil divided out (by 0.8 of the slider), its saturation held to within
// 60% of the way from the px's own to full; below 0 the px pulled towards the airlight as a thicker
// haze would leave it, blended in log by the slider.
vec3 dehaze(vec3 p, float t, float d) {
  vec3 air = hazeAir.xyz;
  p = max(p, 0.0);
  if (d > 0.0) {
    vec3 j = air + (p - air) * ((1.0 / t - 1.0) * 0.8 * min(d, 1.0) + 1.0);
    float mx0 = max(p.r, max(p.g, p.b)), mn0 = min(p.r, min(p.g, p.b));
    float s0 = mx0 > 0.0 ? (mx0 - mn0) / mx0 : 0.0;
    float mx = max(j.r, max(j.g, j.b)), mn = min(j.r, min(j.g, j.b));
    float s = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float cap = s0 + 0.6 * (1.0 - s0);
    // the saturation held: the darkest channel brought up, the others kept in place between it and
    // the brightest (hue and value kept)
    if (s > cap && mx > mn) {
      float mn2 = mx * (1.0 - cap);
      j = mx - (mx - j) * ((mx - mn2) / (mx - mn));
    }
    return max(j, 0.0);
  }
  float flare = hazeAir.w;
  float k = max(d, -1.0);
  float e = t - 25000.0 * flare;
  float w = e * e * e * e * e / t;
  vec3 j = air + (p - air) * w;
  vec3 li = log2(min(p, 1.329228e36) + flare);
  vec3 lj = log2(max(min(j, 1.329228e36), 0.0) + flare);
  return max(exp2(clamp(li + (li - lj) * k, -120.0, 120.0)) - flare, 0.0);
}

// Texture (Camera Raw's, see crates/bezel-core/src/texture.rs): each channel in an encoding near
// log(1 + 100x), packed as a luma (three parts green, one red) and two colour differences.
float texEncodeChannel(float x) {
  x = max(x, 0.0);
  if (x > 1.0) return x * 0.212745 + 0.787255;
  float n = ((((-254.6493 * x + 1163.0652) * x + 5989.897) * x + 1033.5293) * x + 21.488216) * x + 2.2894312e-6;
  float d = ((5938.12 * x + 1917.6111) * x + 97.22948) * x + 1.0;
  return n / d;
}

vec3 textureEncode(vec3 c) {
  float r = texEncodeChannel(c.r), y = texEncodeChannel(c.g) * 0.75 + r * 0.25;
  return vec3(y, (y - r) * 0.5 + 0.5, (y - texEncodeChannel(c.b)) * 0.5 + 0.5);
}

vec3 texChannels(vec3 ycc) {
  float r = ycc.x + 1.0 - 2.0 * ycc.y;
  return vec3(r, (ycc.x - r * 0.25) * 1.33333, ycc.x + 1.0 - 2.0 * ycc.z);
}

// Back to linear: a polynomial fit of the encoding's inverse, kept to 0..1.
vec3 texDecode(vec3 o) {
  o = max(o, 0.0);
  vec3 p = vec3(0.38886127);
  p = p * o - 0.58288366;
  p = p * o + 0.72405446;
  p = p * o - 0.09430415;
  p = p * o + 0.25322843;
  p = p * o + 0.15705566;
  p = p * o + 0.107445545;
  p = p * o + 0.046513084;
  p = p * o + 4.717807e-9;
  return clamp(p, 0.0, 1.0);
}

// Camera Raw's quick 2^x.
float exp2Quad(float x) {
  float n = floor(x), f = x - n;
  return ((f * 0.33977 + 0.66023004) * f + 1.0) * exp2(n);
}

// Each encoded channel moved from the base (\`uTexA\`, \`uTexB\`: its guided filter's a, b, guided by
// the luma) by Texture \`amount\`'s weight, then decoded.
vec3 textureStage(vec3 p, vec2 uv, float amount) {
  vec3 src = textureEncode(p);
  vec2 q = uv * imgInfo.xy / (2.0 * vec2(textureSize(uTexA, 0)));
  vec4 ab = textureLod(uTexA, q, 0.0);
  vec2 ab2 = textureLod(uTexB, q, 0.0).rg;
  vec3 base = clamp(vec3(ab.x, ab.z, ab2.x) * src.x + vec3(ab.y, ab.w, ab2.y), 0.0, 1.0);
  float t = clamp(amount * (amount > 0.0 ? -1.6 : -1.25), -16.0, 16.0);
  float g = t == 0.0 ? 0.0 : (t >= 0.0 ? 1.0 - exp2Quad(-t) : exp2Quad(t) - 1.0);
  float w = 1.0 - 1.2 * g;
  vec3 s = texChannels(src), b = texChannels(base);
  return texDecode(b + w * (s - b));
}

// Camera Raw's output: linear sRGB clipped channel by channel, before the encoding (no gamut
// mapping: colours outside sRGB lose their out-of-range channels).
vec3 outputClip(vec3 c) {
  return clamp(c, 0.0, 1.0);
}

// Sharpening's encoding (Camera Raw's): a gamma of 1.8 with a cubic toe below 0.000821, and back.
float enc18(float x) {
  if (x > 0.0008211879) return exp2(log2(x) * 0.5555556);
  float r5 = 1.0 - x * 1217.748, xa = x * 1217.748;
  return x * 32.0 * r5 * r5 + xa * xa * ((3.0 - 2.0 * xa) * 0.01931085 - r5 * 0.01072825);
}

float dec18(float y) {
  if (y >= 0.01931085) return exp2(log2(y) * 1.8);
  float r2 = (y * 6.536063 + 0.24219136) * y + 0.03125;
  float r4 = y * r2;
  float r5 = ((r4 * -2917177.0 - 7936.1265) * r4 + 32.0) * r4 - y;
  float r4b = (r4 * -8751531.0 - 15872.253) * r4 + 32.0;
  return r2 * y - r5 / r4b;
}

// The look (see crates/bezel-core/src/look.rs): its program run on the photo, mixed by Amount. The
// encodings (\`code\`: look::transfer_code), each way, as DaVinci Resolve's.
float lookEncode(int code, float x) {
  if (code == 1) return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
  if (code == 2) return x < 0.018 ? x * 4.5 : 1.099 * pow(x, 0.45) - 0.099;
  if (code == 3) return pow(max(x, 0.0), 1.0 / 2.2);
  if (code == 4) return pow(max(x, 0.0), 1.0 / 2.4);
  if (code == 5) return pow(max(x, 0.0), 1.0 / 2.6);
  if (code == 6) {
    float b = 0.010797751623277; // 10^((95 - 685) 0.002 / 0.6)
    return (685.0 + 300.0 * log2(max(x * (1.0 - b) + b, 1e-30)) * 0.30102999566) / 1023.0;
  }
  if (code == 7) return x <= 0.00262409 ? x * 10.44426855 : (log2(x + 0.0075) + 7.0) * 0.07329248;
  if (code == 8) return x > 0.010591 ? 0.247190 * log2(5.555556 * x + 0.052272) * 0.30102999566 + 0.385537 : 5.367655 * x + 0.092809;
  if (code == 9) {
    float a = (262144.0 - 16.0) / 117.45, b = 928.0 / 1023.0, c = 95.0 / 1023.0;
    float s = (7.0 * 0.69314718056 * exp2(7.0 - 14.0 * c / b)) / (a * b), t = (exp2(14.0 * (-c / b) + 6.0) - 64.0) / a;
    return x >= t ? (log2(a * x + 64.0) - 6.0) / 14.0 * b + c : (x - t) / s;
  }
  if (code == 10) return x >= 0.01125 ? (420.0 + log2((x + 0.01) / 0.19) * 0.30102999566 * 261.5) / 1023.0 : (x * (171.2102946929 - 95.0) / 0.01125 + 95.0) / 1023.0;
  if (code == 11) return x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * log2(x + 0.00873) * 0.30102999566 + 0.598206;
  if (code == 12) return x <= 0.0078125 ? 10.5402377416545 * x + 0.0729055341958355 : (log2(x) + 9.72) / 17.52;
  return x;
}

float lookDecode(int code, float y) {
  if (code == 1) return y <= 0.04045 ? y / 12.92 : pow((y + 0.055) / 1.055, 2.4);
  if (code == 2) return y < 0.081 ? y / 4.5 : pow((y + 0.099) / 1.099, 1.0 / 0.45);
  if (code == 3) return pow(max(y, 0.0), 2.2);
  if (code == 4) return pow(max(y, 0.0), 2.4);
  if (code == 5) return pow(max(y, 0.0), 2.6);
  if (code == 6) {
    float b = 0.010797751623277;
    return (exp2((1023.0 * y - 685.0) / 300.0 * 3.32192809489) - b) / (1.0 - b);
  }
  if (code == 7) return y <= 0.02740668 ? y / 10.44426855 : exp2(y / 0.07329248 - 7.0) - 0.0075;
  if (code == 8) return y > 5.367655 * 0.010591 + 0.092809 ? (exp2((y - 0.385537) / 0.247190 * 3.32192809489) - 0.052272) / 5.555556 : (y - 0.092809) / 5.367655;
  if (code == 9) {
    float a = (262144.0 - 16.0) / 117.45, b = 928.0 / 1023.0, c = 95.0 / 1023.0;
    float s = (7.0 * 0.69314718056 * exp2(7.0 - 14.0 * c / b)) / (a * b), t = (exp2(14.0 * (-c / b) + 6.0) - 64.0) / a;
    return y >= 0.0 ? (exp2(14.0 * (y - c) / b + 6.0) - 64.0) / a : y * s + t;
  }
  if (code == 10) return y >= 171.2102946929 / 1023.0 ? exp2((y * 1023.0 - 420.0) / 261.5 * 3.32192809489) * 0.19 - 0.01 : (y * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0);
  if (code == 11) return y < 0.181 ? (y - 0.125) / 5.6 : exp2((y - 0.598206) / 0.241514 * 3.32192809489) - 0.00873;
  if (code == 12) return y <= 0.155251141552511 ? (y - 0.0729055341958355) / 10.5402377416545 : exp2(y * 17.52 - 9.72);
  return y;
}

// A look's 1D LUT (each channel's range \`lo\` to \`hi\`, size \`n\`), from row \`row\` of the shaper
// texture.
vec3 lookShaper(vec3 q, vec3 lo, vec3 hi, float n, int row) {
  vec3 pos = clamp((q - lo) / (hi - lo), 0.0, 1.0) * (n - 1.0);
  vec3 o;
  for (int c = 0; c < 3; c++) {
    int i = min(int(floor(pos[c])), int(n) - 2);
    float f = pos[c] - float(i);
    float a = texelFetch(uLookShaper, ivec2(i % 1024, row + i / 1024), 0)[c];
    float b = texelFetch(uLookShaper, ivec2((i + 1) % 1024, row + (i + 1) / 1024), 0)[c];
    o[c] = a + (b - a) * f;
  }
  return o;
}

// A look's 3D LUT (each channel's range \`lo\` to \`hi\`, size \`n\`), at \`at\` in the 3D texture, read
// trilinearly or tetrahedrally.
vec3 lookLut(vec3 q, vec3 lo, vec3 hi, float n, bool tetrahedral, ivec3 at) {
  vec3 pos = clamp((q - lo) / (hi - lo), 0.0, 1.0) * (n - 1.0);
  ivec3 cell = min(ivec3(floor(pos)), ivec3(int(n) - 2));
  vec3 f = pos - vec3(cell);
  ivec3 i = cell + at;
  vec3 c000 = texelFetch(uLook, i, 0).rgb, c111 = texelFetch(uLook, i + 1, 0).rgb;
  if (tetrahedral) {
    vec3 a, b;
    vec3 w;
    if (f.r > f.g) {
      if (f.g > f.b) {
        a = texelFetch(uLook, i + ivec3(1, 0, 0), 0).rgb; b = texelFetch(uLook, i + ivec3(1, 1, 0), 0).rgb; w = vec3(f.r - f.g, f.g - f.b, f.b);
      } else if (f.r > f.b) {
        a = texelFetch(uLook, i + ivec3(1, 0, 0), 0).rgb; b = texelFetch(uLook, i + ivec3(1, 0, 1), 0).rgb; w = vec3(f.r - f.b, f.b - f.g, f.g);
      } else {
        a = texelFetch(uLook, i + ivec3(0, 0, 1), 0).rgb; b = texelFetch(uLook, i + ivec3(1, 0, 1), 0).rgb; w = vec3(f.b - f.r, f.r - f.g, f.g);
      }
    } else if (f.b > f.g) {
      a = texelFetch(uLook, i + ivec3(0, 0, 1), 0).rgb; b = texelFetch(uLook, i + ivec3(0, 1, 1), 0).rgb; w = vec3(f.b - f.g, f.g - f.r, f.r);
    } else if (f.b > f.r) {
      a = texelFetch(uLook, i + ivec3(0, 1, 0), 0).rgb; b = texelFetch(uLook, i + ivec3(0, 1, 1), 0).rgb; w = vec3(f.g - f.b, f.b - f.r, f.r);
    } else {
      a = texelFetch(uLook, i + ivec3(0, 1, 0), 0).rgb; b = texelFetch(uLook, i + ivec3(1, 1, 0), 0).rgb; w = vec3(f.g - f.r, f.r - f.b, f.b);
    }
    return c000 * (1.0 - w.x - w.y - w.z) + a * w.x + b * w.y + c111 * w.z;
  }
  vec3 c100 = texelFetch(uLook, i + ivec3(1, 0, 0), 0).rgb, c010 = texelFetch(uLook, i + ivec3(0, 1, 0), 0).rgb;
  vec3 c110 = texelFetch(uLook, i + ivec3(1, 1, 0), 0).rgb, c001 = texelFetch(uLook, i + ivec3(0, 0, 1), 0).rgb;
  vec3 c101 = texelFetch(uLook, i + ivec3(1, 0, 1), 0).rgb, c011 = texelFetch(uLook, i + ivec3(0, 1, 1), 0).rgb;
  vec3 x00 = mix(c000, c100, f.r), x10 = mix(c010, c110, f.r), x01 = mix(c001, c101, f.r), x11 = mix(c011, c111, f.r);
  return mix(mix(x00, x10, f.g), mix(x01, x11, f.g), f.b);
}

// DaVinci Resolve's DaVinci tone mapping (crates/bezel-core/src/colorspace.rs \`DavinciTm\`), per
// channel: scene to display (\`t\`: the largest scene and display luminance), and back.
float tmB(vec2 t) {
  return t.x * (t.y - 0.09) / (t.x - t.y);
}

vec3 toneMapDr(vec3 s, vec2 t) {
  float b = tmB(t);
  s = max(s, 0.0);
  return t.y * s * (t.x + b) / (t.x * (s + b));
}

vec3 toneUnmapDr(vec3 d, vec2 t) {
  float b = tmB(t), a = t.y * (t.x + b) / t.x;
  d = clamp(d, 0.0, t.y);
  return b * d / (a - d);
}

vec3 encodeAll(int code, vec3 q) {
  return vec3(lookEncode(code, q.r), lookEncode(code, q.g), lookEncode(code, q.b));
}

vec3 decodeAll(int code, vec3 q) {
  return vec3(lookDecode(code, q.r), lookDecode(code, q.g), lookDecode(code, q.b));
}

// The look's program on a colour (linear ProPhoto in and out; \`look::run\` is the same on the CPU).
vec3 lookStage(vec3 p) {
  int n = int(lk0.y + 0.5);
  vec3 q = p, kept = p;
  int i = 0;
  for (int k = 0; k < 128; k++) {
    if (i >= n) break;
    vec4 h = lp[i];
    int op = int(h.x + 0.5);
    if (op == 1) {
      vec4 a = lp[i + 1], b = lp[i + 2], c = lp[i + 3];
      q = vec3(dot(a.xyz, q) + a.w, dot(b.xyz, q) + b.w, dot(c.xyz, q) + c.w);
      i += 4;
    } else if (op == 2) {
      q = encodeAll(int(h.y + 0.5), q);
      i += 1;
    } else if (op == 3) {
      q = decodeAll(int(h.y + 0.5), q);
      i += 1;
    } else if (op == 4) {
      q = toneMapDr(q, h.yz);
      i += 1;
    } else if (op == 5) {
      q = toneUnmapDr(q, h.yz);
      i += 1;
    } else if (op == 6) {
      q = lookLut(q, vec3(h.y), vec3(h.z), h.w, lp[i + 1].x > 0.5, ivec3(lp[i + 2].xyz + 0.5));
      i += 3;
    } else if (op == 7) {
      q = lookShaper(q, vec3(h.y), vec3(h.z), h.w, int(lp[i + 1].x + 0.5));
      i += 2;
    } else if (op == 14) {
      // a 3D LUT whose channels have ranges of their own (a .cube's DOMAIN_MIN and DOMAIN_MAX)
      q = lookLut(q, lp[i + 1].xyz, lp[i + 2].xyz, h.y, h.z > 0.5, ivec3(lp[i + 3].xyz + 0.5));
      i += 4;
    } else if (op == 15) {
      // a 1D LUT the same
      q = lookShaper(q, lp[i + 1].xyz, lp[i + 2].xyz, h.y, int(lp[i + 3].x + 0.5));
      i += 4;
    } else if (op == 12) {
      kept = q;
      i += 1;
    } else if (op == 13) {
      q = kept + h.y * (q - kept);
      i += 1;
    } else if (op == 11) {
      // Resolve's primaries (crates/bezel-core/src/drx.rs \`Primaries::run\`): Offset, Contrast round
      // Pivot, Saturation against its luma
      q = h.z + h.y * (q + lp[i + 1].xyz - h.z);
      float l = dot(q, vec3(0.21, 0.70, 0.09));
      q = l + h.w * (q - l);
      i += 2;
    } else if (op == 8) {
      q = clamp(q, h.y, h.z);
      i += 1;
    } else if (op == 9) {
      q = (64.0 + q * 876.0) / 1023.0;
      i += 1;
    } else if (op == 10) {
      q = (q * 1023.0 - 64.0) / 876.0;
      i += 1;
    } else {
      break;
    }
  }
  return p + (q - p) * lk0.x;
}

// \`covered\`: a redacted pixel, whose local adjustments (Highlights/Shadows, Clarity, Texture, Dehaze,
// Sharpening) must not follow the original's planes: they keep its detail, so they would draw what
// was covered back in. \`mag\`: how much a magnifier enlarges this pixel (1 outside one). With the
// plan cut (\`ex0.w\`), the pixel through the exposure stage, encoded for Texture's base.
vec3 develop(vec3 c, vec2 uv, bool covered, float mag) {
  float ev = tone.x;
  float whites = tone2.x, blacks = tone2.y, vib = tone2.z, sat = tone2.w;
  float tex = fx.y, clar = fx.z, dz = fx.w;

  // white balance, Dehaze, the post-crop vignette, then Highlights and Shadows (Camera Raw's tone
  // map), in linear ProPhoto before Exposure; then white balance's lift. A raw's white balance takes
  // its camera's RGB (the source) to linear ProPhoto.
  bool dehazing = dz != 0.0 && hazeAir.x > 0.0 && !covered;
  bool balancing = wbr.w > 0.5, raw = raw0.x > 0.5;
  if (raw || balancing || dehazing || vig.x != 0.0 || tm4.w > 0.5) {
    vec3 p = raw ? c : TO_PROPHOTO * c;
    if (balancing) p = whiteBalance(p);
    // a raw's white balance's darkening made up at once: what follows works on the light on the
    // scale its statistics were measured on (Camera Raw's own scale differs only in its epsilons)
    // a raw measured for Auto's B&W mix: its light as white balanced, before the gain (Camera Raw's
    // white balance stage's)
    if (raw0.y > 2.5) return FROM_PROPHOTO * p;
    if (raw) p *= wbr.z;
    // a raw measured for its white: its light as white balanced (Camera Raw measures a raw there)
    if (raw0.y > 0.5 && raw0.y < 1.5) return FROM_PROPHOTO * min(p, vec3(1.0));
    if (dehazing) p = dehaze(p, textureLod(uDehaze, uv, 0.0).r, dz);
    // a raw's profile's hue/saturation map, on its light without white balance's darkening (Camera
    // Raw's tops out at 1 before it)
    if (hsv0.x > 0.5) p = hsvTable(p, hsv0, 0, raw ? wbr.z : 1.0);
    // a raw measured for its statistics: its light through the profile's map, before the gain (the
    // render can't hold light above 1)
    if (raw0.y > 1.5) return FROM_PROPHOTO * (p / wbr.z);
    if (vig.x != 0.0) p = postCropVignette(p, uv * imgInfo.xy);
    if (tm4.w > 0.5) p = covered ? toneMapBy(p, coverMask) : toneMap(p, uv);
    if (balancing && !raw) p *= wbr.z;
    c = FROM_PROPHOTO * p;
  }

  // Exposure below 0 is a gain; above 0 it rolls off (see \`lightroomTone\`)
  c *= exp2(min(ev, 0.0));

  // Lightroom's order, in linear ProPhoto: its exposure stage, Texture, Saturation, Clarity below 0,
  // its HSL stage (Vibrance and the Color Mixer); then Contrast and the tone curve
  bool tones = mode.w > 0.5, mixer = fx3.z > 0.5, clarity = mode.z > 0.5 && !covered;
  bool cut = ex0.w > 0.5, texturing = tex != 0.0 && mode.y > 0.5 && !covered;
  if (tones || cut || texturing || sat != 0.0 || vib != 0.0 || mixer || clarity) {
    vec3 p = TO_PROPHOTO * c;
    if (tones) p = exposureStage(p, whites, blacks);
    if (cut) return textureEncode(p);
    if (texturing) p = textureStage(p, uv, tex);
    if (sat != 0.0) p = saturate(p, sat);
    if (clarity) p = clarityNeg(p, textureLod(uClarity, uv, 0.0).r, clar);
    // a raw's profile's look table (with a look's own merged in), after Saturation; Monochrome's
    // own after it, then its black and white
    if (hsv1.x > 0.5) p = hsvTable(p, hsv1, int(hsv0.y * hsv0.z), 1.0);
    if (hsv2.x > 0.5) p = hsvTable(p, hsv2, int(hsv0.y * hsv0.z + hsv1.y * hsv1.z), 1.0);
    if (raw0.w > 0.5) p = grayStage(p);
    if (vib != 0.0 || mixer) p = hslStage(p, vib, mixer);
    c = FROM_PROPHOTO * p;
  }

  // the base-curve stage: a negative total exposure's first stop, a raw's base curve
  if (raw0.z > 0.5) c = FROM_PROPHOTO * baseCurve(TO_PROPHOTO * c);

  // Contrast and the tone curve: one stage of Camera Raw's, on sRGB-encoded ProPhoto
  if (fx.x > 0.5) {
    c = FROM_PROPHOTO * decodeSrgb(toneCurve(encodeSrgb(TO_PROPHOTO * c)));
  }
  // the look, on the photo as adjusted: a film print renders it, as the last node of a grade in
  // DaVinci Resolve does
  if (lk0.y > 0.5 && lk0.x != 0.0 && !covered) c = FROM_PROPHOTO * lookStage(TO_PROPHOTO * c);
  // with Sharpening, the render's first phase ends here (linear ProPhoto; see main)
  if (shp.x > 0.5 && !covered) return TO_PROPHOTO * c;
  return outputClip(c);
}



uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

float rnd(uvec2 p, uint seed) {
  return float(pcg(p.x ^ pcg(p.y ^ pcg(seed)))) * (1.0 / 4294967296.0);
}

// Cover stored px \`p\` with the topmost redaction over it. Pixelate shows each block's average (a
// coarse mip level at the block's centre), blur a coarse mip level, solid black: nothing finer than a
// block reaches the output. Per-block noise keeps the averages from being exact.
bool redact(vec2 p, inout vec3 c) {
  for (int i = int(rinfo.x) - 1; i >= 0; i--) {
    vec4 a = rdata[i * 3];
    vec4 b = rdata[i * 3 + 1];
    vec4 k = rdata[i * 3 + 2];
    vec2 d = p - a.xy;
    vec2 q = vec2(d.x * b.x + d.y * b.y, d.y * b.x - d.x * b.y); // into the region's frame
    vec2 u = q / max(a.zw, vec2(1e-3));
    bool inside = k.x < 0.5 ? max(abs(u.x), abs(u.y)) <= 1.0 : dot(u, u) <= 1.0;
    if (!inside) continue;
    if (k.y > 1.5) {
      c = vec3(0.0);
      return true;
    }
    float cell = max(b.z, 1.0);
    float lod = log2(cell);
    uint seed = uint(b.w) | (uint(k.z) << 16u);
    if (k.y < 0.5) {
      vec2 ci = floor(q / cell);
      vec2 qc = (ci + 0.5) * cell;
      vec2 pc = a.xy + vec2(qc.x * b.x - qc.y * b.y, qc.x * b.y + qc.y * b.x);
      c = textureLod(uSrc, pc * imgInfo.zw, lod).rgb;
      c *= 1.0 + (rnd(uvec2(ivec2(ci) + 32768), seed) - 0.5) * 0.08;
      // (its Highlights/Shadows by the block's own average, one value a block as its colour is)
      if (tm4.w > 0.5) coverMask = maskOver(pc, cell);
    } else {
      c = textureLod(uSrc, p * imgInfo.zw, lod + 0.75).rgb;
      c *= 1.0 + (rnd(uvec2(ivec2(floor(q / cell * 3.0)) + 32768), seed) - 0.5) * 0.04;
      if (tm4.w > 0.5) coverMask = maskCells(a.xy, b.xy, q, cell);
    }
    return true;
  }
  return false;
}

// The photo under a panel, as iOS's materials show it: blurred about \`ginfo.y\` device px (a mip level
// that wide, four taps on a turned half-texel grid to smooth its blocks); its colour is lifted once
// it's developed (see \`lifted\`: a raw's photo here is still the camera's RGB).
vec3 frosted(vec2 p) {
  float lod = log2(max(ginfo.y * length(mapX.xy), 1.0));
  float r = exp2(lod) * 0.5;
  vec4 s = textureLod(uSrc, (p + vec2(-r, -0.5 * r)) * imgInfo.zw, lod)
         + textureLod(uSrc, (p + vec2(0.5 * r, -r)) * imgInfo.zw, lod)
         + textureLod(uSrc, (p + vec2(r, 0.5 * r)) * imgInfo.zw, lod)
         + textureLod(uSrc, (p + vec2(-0.5 * r, r)) * imgInfo.zw, lod);
  s *= 0.25;
  if (tm4.w > 0.5) coverMask = maskOver(p, 4.0 * r);
  return mix(vec3(1.0), s.rgb, s.a);
}

// The frosted photo's colour lifted a little, as iOS's materials lift it, and shaded: a bright photo
// under a panel never washes it out (linear sRGB, as shown).
const float GLASS_SHADE = 0.75;
vec3 lifted(vec3 c) {
  float y = dot(c, LUMA);
  return max(vec3(y) + (c - vec3(y)) * 1.35, 0.0) * GLASS_SHADE;
}

// Lightroom's Visualize Spots: the photo's fine detail (log luminance against a blur a few screen px
// wide) lit white on black, so specks and hairs stand out; \`fx3.y\` (0..1) the contrast, from only
// the coarsest to the finest.
vec3 visualize(vec2 uv, float mag) {
  float px = max(length(mapX.xy) / mag, 1.0);
  float lod = log2(px);
  vec2 d = vec2(1.5 * px) * imgInfo.zw;
  float l0 = logLumAt(uv, lod);
  float lb = 0.25 * (logLumAt(uv + vec2(d.x, d.y), lod + 1.5) + logLumAt(uv + vec2(-d.x, d.y), lod + 1.5) +
                     logLumAt(uv + vec2(d.x, -d.y), lod + 1.5) + logLumAt(uv - d, lod + 1.5));
  // the detail (EV) that shows: half a stop at no contrast, a twenty-fifth at full
  float th = 0.5 * pow(0.08, fx3.y);
  return vec3(sstep(0.6 * th, 1.4 * th, abs(l0 - lb)));
}

// How far output px \`o\` (stored px \`p\`) lies inside the photo as shown, its image within its clip, in
// output px (negative outside).
float inPhoto(vec2 o, vec2 p) {
  vec2 img = min(p, imgInfo.xy - p) / length(mapX.xy);
  vec2 cl = min(o - clip.xy, clip.zw - o);
  return min(min(img.x, img.y), min(cl.x, cl.y));
}

// Camera Raw's dither for 8 bits (adjusted gradients don't band): a px's one value, uniform over a
// level, shared by its channels.
vec3 dither(vec3 enc) {
  uvec2 px = uvec2(gl_FragCoord.xy);
  return enc + (rnd(px, 1u) - 0.5) / 255.0;
}

void main() {
  // With Sharpening, the render's second phase: what the first left (\`shp.zw\` its origin here), the
  // photo's px sharpened by the factor its passes made (see sharpen.frag), out to the display.
  if (shp.x > 1.5) {
    ivec2 at = ivec2(gl_FragCoord.xy - shp.zw);
    vec4 s = texelFetch(uShp, at, 0);
    vec3 lin = s.rgb;
    if (s.a > 0.75) {
      vec3 e = clamp(texelFetch(uShK, at, 0).r * s.rgb, 0.0, 1.0);
      lin = outputClip(FROM_PROPHOTO * vec3(dec18(e.r), dec18(e.g), dec18(e.b)));
    }
    vec3 enc = encodeSrgb(lin);
    if (s.a > 0.25) {
      enc = dither(enc);
    }
    fragColor = vec4(enc, 1.0);
    return;
  }

  // Output pixel centre, y down, relative to the stage (the viewport's origin may lie further out,
  // for the panels around it). The screen's origin is bottom-left; exports render to an FBO that is
  // read back bottom row first, so they are not flipped.
  vec2 f = gl_FragCoord.xy - view.xy;
  vec2 o = vec2(f.x, outInfo.z > 0.5 ? outInfo.y - f.y : f.y);
  vec2 p = vec2(dot(mapX.xyz, vec3(o, 1.0)), dot(mapY.xyz, vec3(o, 1.0)));
  // a panel over this pixel: its colour over the photo, frosted, where the photo reaches under it
  int pane = -1;
  for (int i = 0; i < int(ginfo.x); i++) {
    vec4 r = gdata[i * 2];
    if (all(greaterThanEqual(o, r.xy)) && all(lessThan(o, r.zw))) {
      pane = i;
      break;
    }
  }
  vec4 tint = pane < 0 ? vec4(bg.rgb, 0.0) : gdata[pane * 2 + 1];
  // inside a magnifier, show its source enlarged (still redacted and developed like the rest)
  float mag = 1.0;
  for (int i = int(iinfo.x) - 1; i >= 0 && pane < 0; i--) {
    vec4 m = idata[i * 2];
    if (distance(p, m.xy) <= m.z) {
      p = idata[i * 2 + 1].xy + (p - m.xy) / m.w;
      mag = m.w;
      break;
    }
  }
  vec2 uv = p * imgInfo.zw;
  // (its derivatives across the pixel, worked out: the same mip level on every GPU, and in WGSL)
  vec2 uvDx = vec2(mapX.x, mapY.x) * imgInfo.zw / mag;
  vec2 uvDy = vec2(mapX.y, mapY.y) * ((outInfo.z > 0.5 ? -1.0 : 1.0) * imgInfo.zw) / mag;

  vec3 out_ = tint.rgb;
  bool dithered = false;
  bool inClip = all(greaterThanEqual(o, clip.xy)) && all(lessThan(o, clip.zw));
  bool onPhoto = inClip && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
  // under a panel the photo's own edges blur as its content does: it fades into the panel's colour
  // across the blur's width
  float cover = pane < 0 ? 1.0 : clamp(0.5 + inPhoto(o, p) / max(ginfo.y, 1.0), 0.0, 1.0);
  if (onPhoto || (pane >= 0 && cover > 0.0)) {
    // the photo here, or under a panel its blur: a redaction shows as itself either way (a panel
    // never blurs what one hides), and under a panel the planes are not read (one develop() for both)
    vec4 s = textureGrad(uSrc, uv, uvDx, uvDy);
    vec3 lin = mix(vec3(1.0), s.rgb, s.a); // transparent pixels sit on white, like a JPEG export
    bool covered = onPhoto && redact(p, lin);
    if (!covered && pane >= 0) lin = frosted(p);
    if (mode.x < 0.5) lin = develop(lin, uv, covered || pane >= 0, mag);
    if (!covered && pane >= 0) lin = lifted(lin);
    if (ex0.w > 0.5) {
      // the render Texture's base is made from: its encoded planes as they are
      fragColor = vec4(lin, 1.0);
      return;
    }
    if (fx3.x > 0.5 && pane < 0 && !covered) {
      lin = visualize(uv, mag);
    } else if (shp.x > 0.5 && mode.x < 0.5 && pane < 0 && !covered) {
      // with Sharpening, the render's first phase: the px through the tone curve (linear ProPhoto),
      // encoded for it, and its luma
      vec3 c = clamp(lin, 0.0, 1.0);
      fragColor = vec4(enc18(c.r), enc18(c.g), enc18(c.b), 1.0);
      fragLuma = vec4(enc18(clamp(dot(c.rg, vec2(0.28808594, 0.71191406)), 0.0, 1.0)), 0.0, 0.0, 1.0);
      return;
    }
    out_ = mix(tint.rgb, mix(lin, tint.rgb, tint.a), cover);
    dithered = outInfo.w > 0.5 && pane < 0;
  }
  if (shp.x > 0.5) {
    // the first phase: what isn't sharpened as it is (alpha: dithered 0.5, or not 0), and its luma
    // for its neighbours' blurs
    fragColor = vec4(out_, dithered ? 0.5 : 0.0);
    vec3 c = clamp(TO_PROPHOTO * out_, 0.0, 1.0);
    fragLuma = vec4(enc18(clamp(dot(c.rg, vec2(0.28808594, 0.71191406)), 0.0, 1.0)), 0.0, 0.0, 1.0);
    return;
  }
  vec3 enc = encodeSrgb(out_);
  if (dithered) {
    enc = dither(enc);
  }
  fragColor = vec4(enc, 1.0);
}
`,`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// The photo as last drawn, copied back where it was (\`uOrigin\`: its viewport's origin here); or,
// while a quarter turn is shown (\`uTurned\`), drawn turned, scaled and shifted: each window px \`q\`
// takes the cache's px \`uM * q + uT\`, between its four nearest (the background \`uBg\` past what was
// drawn in it, \`uSize\`: it has room to grow, and what's past that is an older drawing's).
uniform sampler2D uTex;
uniform vec2 uOrigin;
uniform float uTurned;
uniform vec4 uM;
uniform vec2 uT;
uniform vec2 uSize;
uniform vec4 uBg;

out vec4 fragColor;

vec4 at(ivec2 i, ivec2 size) {
  if (any(lessThan(i, ivec2(0))) || any(greaterThanEqual(i, size))) {
    return uBg;
  }
  return texelFetch(uTex, i, 0);
}

void main() {
  if (uTurned < 0.5) {
    fragColor = texelFetch(uTex, ivec2(gl_FragCoord.xy - uOrigin), 0);
    return;
  }
  vec2 q = gl_FragCoord.xy;
  vec2 p = vec2(dot(uM.xy, q), dot(uM.zw, q)) + uT - 0.5;
  ivec2 size = ivec2(uSize);
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec4 top = mix(at(i, size), at(i + ivec2(1, 0), size), f.x);
  vec4 bottom = mix(at(i + ivec2(0, 1), size), at(i + ivec2(1, 1), size), f.x);
  fragColor = mix(top, bottom, f.y);
}
`,`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// A mip level from the one above it (\`uSrc\`, read at its base level, which is set to the level
// above): each px the mean of the area it covers there, weighted by how much of each px it covers
// (2 × 2 px, or 3 across where the level above is odd), in linear light (an sRGB texture decodes as
// it's read and encodes as it's written). The weights are whole numbers, so every GPU makes the
// same levels, where each driver's own mipmaps differ.
uniform sampler2D uSrc;
uniform ivec2 uSize; // the level above's size

out vec4 fragColor;

void main() {
  ivec2 dst = ivec2(gl_FragCoord.xy);
  ivec2 n = max(uSize / 2, ivec2(1));
  // the area covered, in 1/n of a px above
  ivec2 lo = dst * uSize, hi = lo + uSize;
  ivec2 first = lo / n;
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 3; j++) {
    int y = first.y + j;
    int wy = min((y + 1) * n.y, hi.y) - max(y * n.y, lo.y);
    if (wy <= 0) continue;
    for (int i = 0; i < 3; i++) {
      int x = first.x + i;
      int wx = min((x + 1) * n.x, hi.x) - max(x * n.x, lo.x);
      if (wx <= 0) continue;
      sum += float(wx * wy) * texelFetch(uSrc, min(ivec2(x, y), uSize - 1), 0);
    }
  }
  fragColor = sum / float(uSize.x * uSize.y);
}
`].flatMap(e=>{let t=o.createProgram();if(!t)return[];for(let[n,i]of[[o.VERTEX_SHADER,l],[o.FRAGMENT_SHADER,r(e)]]){let e=o.createShader(n);if(!e)return[];o.shaderSource(e,i),o.compileShader(e),o.attachShader(t,e),o.deleteShader(e)}return o.linkProgram(t),[t]});o.flush();let d=performance.now()+n,f=()=>{u.every(e=>o.getProgramParameter(e,s.COMPLETION_STATUS_KHR))||performance.now()>d?c():setTimeout(f,100)};setTimeout(f,100)}export{a as prewarm};