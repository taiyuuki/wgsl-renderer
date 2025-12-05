struct Uniforms {
    resolution: vec2<f32>,
    rippleSpeed: f32,
    rippleDecay: f32,
    frameTime: f32,
    useMask: f32,
};

// Vertex shader outputs
struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Simulate Force Pass
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var forceTexture : texture_2d<f32>;
@group(0) @binding(2) var maskTexture : texture_2d<f32>;

@vertex
fn vs_main(@location(0) p: vec3<f32>) -> VSOut {
    var o: VSOut;
    o.pos = vec4<f32>(p, 1.0);
    o.uv = p.xy * 0.5 + vec2<f32>(0.5, 0.5);
    // 不翻转Y坐标，保持与force pass一致
    return o;
}

fn sampleForce(a: vec4<f32>, b: vec4<f32>, c: vec4<f32>) -> vec4<f32> {
    return max(a, max(b, c));
}

fn saturate(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = textureDimensions(forceTexture).xy;
    let texel = 1.0 / vec2<f32>(texSize);

    let rippleOffset = texel * 100.0 * uniforms.rippleSpeed * min(1.0 / 30.0, uniforms.frameTime);
    let insideRipple = rippleOffset * 1.61;
    let outsideRipple = rippleOffset;

    // Boundary reflection
    let reflectUp = step(1.0 - texel.y, uv.y);
    let reflectDown = step(uv.y, texel.y);
    let reflectLeft = step(1.0 - texel.x, uv.x);
    let reflectRight = step(uv.x, texel.x);

    // Sample surrounding pixels - exactly like the original GLSL
    let texSizeF32 = vec2<f32>(texSize);
    let maxCoord = texSizeF32 - 1.0;

    let uc = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(0.0, -insideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let u00 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(-outsideRipple.x, -outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let u10 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(outsideRipple.x, -outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);

    let dc = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(0.0, insideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let d01 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(-outsideRipple.x, outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let d11 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(outsideRipple.x, outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);

    let lc = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(-insideRipple.x, 0.0)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let l00 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(-outsideRipple.x, -outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let l01 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(-outsideRipple.x, outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);

    let rc = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(insideRipple.x, 0.0)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let r10 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(outsideRipple.x, -outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);
    let r11 = textureLoad(forceTexture, vec2<i32>(clamp((uv + vec2<f32>(outsideRipple.x, outsideRipple.y)) * texSizeF32, vec2<f32>(0.0), maxCoord)), 0);

    let up = sampleForce(uc, u00, u10);
    let down = sampleForce(dc, d01, d11);
    let left = sampleForce(lc, l00, l01);
    let right = sampleForce(rc, r10, r11);

    // Use the original GLSL algorithm exactly - manual component assignment
    var force = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    let componentScale = 1.0 / 3.0;

    // force.xzy += up.xzy  -> force.x += up.x, force.z += up.z, force.y += up.y
    force.x += up.x;
    force.z += up.z;
    force.y += up.y;

    // force.xzw += down.xzw  -> force.x += down.x, force.z += down.z, force.w += down.w
    force.x += down.x;
    force.z += down.z;
    force.w += down.w;

    // force.xyw += left.xyw  -> force.x += left.x, force.y += left.y, force.w += left.w
    force.x += left.x;
    force.y += left.y;
    force.w += left.w;

    // force.zyw += right.zyw  -> force.z += right.z, force.y += right.y, force.w += right.w
    force.z += right.z;
    force.y += right.y;
    force.w += right.w;

    force *= componentScale;

    // Apply boundary reflection
    let reflectionScale = 1.0;
    let forceCopy = force;

    force.y = mix(force.y, forceCopy.w * reflectionScale, reflectDown);
    force.w = mix(force.w, forceCopy.y * reflectionScale, reflectUp);
    force.x = mix(force.x, forceCopy.z * reflectionScale, reflectRight);
    force.z = mix(force.z, forceCopy.x * reflectionScale, reflectLeft);

    // Apply mask if enabled
    if uniforms.useMask > 0.5 {
        // Flip Y coordinate to match the final display
        let maskCoords = vec2<f32>(uv.x, 1.0 - uv.y);
        let maskSample = textureLoad(maskTexture, vec2<i32>(clamp(maskCoords * vec2<f32>(textureDimensions(maskTexture)), vec2<f32>(0.0), vec2<f32>(textureDimensions(maskTexture)) - 1.0)), 0);

        // Use mask.r channel for ripple control (0.0 = completely block, 1.0 = full effect)
        let maskValue = maskSample.r;

        // Completely block ripples in black areas (maskValue == 0)
        if maskValue <= 0.0 {
            return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }

        // Apply dynamic decay based on mask intensity
        // Middle values (0.1-0.8) increase ripple decay rate
        if maskValue < 0.9 {
            // Interpolate decay rate: 0.8 for low mask values, 0.95 for high values
            let dynamicDecayRate = mix(0.6, 0.95, maskValue / 0.9);
            force *= dynamicDecayRate;
        }
    }

    // Apply much more aggressive decay to stop infinite propagation
    let forceMagnitude = dot(force, vec4<f32>(1.0, 1.0, 1.0, 1.0));

    // Clear forces completely if they're very small - this is key to stopping infinite ripples
    if forceMagnitude < 0.01 {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    // Very aggressive multiplicative decay - this is much more effective than subtractive
    let decayRate = select(0.80, 0.95, forceMagnitude >= 0.05); // 20% for small forces, 5% for large forces
    force *= decayRate;

    // Also apply the original GLSL decay as additional safeguard
    let baseDrop = max(1.001 / 255.0, 1.5 / 255.0 * (uniforms.frameTime / 0.02) * uniforms.rippleDecay);
    force -= baseDrop;

    return max(force, vec4<f32>(0.0));
}