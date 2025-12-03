struct Uniforms {
    resolution: vec2<f32>, // x=res.x y=res.y
    time: f32,
    miku_tex_resolution: vec2<f32>, // x=tex.width y=tex.height
    mask_tex_resolution: vec2<f32>, // x=tex.width y=tex.height
    normal_tex_resolution: vec2<f32>, // x=tex.width y=tex.height
    speed: f32,
    scroll_speed: f32,
    angle: f32,
    ratio: f32,
    strength: f32,
    scale: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex : texture_2d<f32>;
@group(0) @binding(3) var mask_tex : texture_2d<f32>;
@group(0) @binding(4) var normal_tex : texture_2d<f32>;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

fn rotation2d(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

@vertex
fn vs_main(@location(0) p: vec3<f32>) -> VSOut {
    var o: VSOut;
    o.pos = vec4<f32>(p, 1.0);
    o.uv = p.xy * 0.5 + vec2<f32>(0.5, 0.5);
    o.uv.y = 1.0 - o.uv.y;
    return o;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {

    let speed = uniforms.speed;
    let scroll_speed = uniforms.scroll_speed;
    let angle = uniforms.angle;
    let ratio = uniforms.ratio;
    let strength = uniforms.strength;
    let scale = uniforms.scale;

    let time = uniforms.time;

    let coords_rotated = uv;
    let coords_rotated2 = uv * 1.333;
    let scroll = rotation2d(vec2<f32>(0.0, 1.0), angle) * scroll_speed * scroll_speed * time;
    var tex_coord_ripple = (coords_rotated + time * speed * speed + scroll) * scale;
    var tex_coord_ripple2 = (coords_rotated2 - time * speed * speed * 1.5 + scroll) * scale;

    let ripple_texture_adj = uniforms.miku_tex_resolution.x / uniforms.miku_tex_resolution.y;
    tex_coord_ripple.x *= ripple_texture_adj;
    tex_coord_ripple2.x *= ripple_texture_adj;
    tex_coord_ripple.y *= ratio;
    tex_coord_ripple2.y *= ratio;

    let mask = textureSample(mask_tex, samp, uv);
    let n1 = textureSample(normal_tex, samp, fract(tex_coord_ripple)) * 2.0 - 1.0;
    let n2 = textureSample(normal_tex, samp, fract(tex_coord_ripple2)) * 2.0 - 1.0;
    let normal = normalize(vec3(n1.xy + n2.xy, n1.z));

    let tex_coord = uv + normal.xy * strength * strength * mask.r;

    return textureSample(tex, samp, tex_coord); // alpha mask
}