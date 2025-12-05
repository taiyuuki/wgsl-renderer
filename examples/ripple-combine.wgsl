struct Uniforms {
    resolution: vec2<f32>,
    rippleStrength: f32,
};

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var<uniform> uniforms : Uniforms;
@group(0) @binding(2) var sourceTexture : texture_2d<f32>;
@group(0) @binding(3) var rippleTexture : texture_2d<f32>;

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
    let rippleCoords = uv;

    let rippleTexSize = vec2<f32>(textureDimensions(rippleTexture));
    let maxRippleCoord = rippleTexSize - 1.0;

    let albedo = textureLoad(rippleTexture, vec2<i32>(clamp(rippleCoords * rippleTexSize, vec2<f32>(0.0), maxRippleCoord)), 0);
    let albedoSquared = albedo * albedo;

    let dir = vec2<f32>(albedoSquared.x - albedoSquared.z, albedoSquared.y - albedoSquared.w);

    let distortAmt = uniforms.rippleStrength;
    let offset = dir * (-0.1 * distortAmt);

    let finalCoords = clamp(uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
    let screen = textureSample(sourceTexture, samp, finalCoords);

    return screen;
}