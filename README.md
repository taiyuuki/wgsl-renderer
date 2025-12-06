# WGSL Multi-Pass Renderer

English | [中文](./README.zh-CN.md)

A multi-pass renderer based on WebGPU and WGSL.

## ✨ Features

- 🖼️ **Multi-Pass Rendering** - Support for texture rendering, post-processing effects, and other multi-pass rendering
- ⚡ **High-Performance Rendering Loop** - Support for single-frame rendering and loop rendering modes
- 🛠️ **TypeScript Support** - Complete type definitions and clear API separation
- 🎮 **Uniform System** - Built-in uniform buffer management with dynamic parameter support

## 🚀 Quick Start

### Installation

```bash
npm i wgls-renderer
```

### Add Pass

```typescript
import { createWGSLRenderer } from 'wgls-renderer'

const canvas = document.querySelector('canvas');
const renderer = await createWGSLRenderer(canvas)

renderer.addPass({
    name: 'my-pass',
    shaderCode: `
struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

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
    return vec4(1.0, 1.0, 0.0, 1.0);
}`,
})

renderer.renderFrame()
```



### Basic Multi-Pass Usage

```typescript
import { createWGSLRenderer } from 'wgls-renderer'

const canvas = document.getElementById('canvas')
const renderer = await createWGSLRenderer(canvas)

// Create sampler
const sampler = renderer.createSampler()

// Load image texture
const { texture, width, height } = await renderer.loadImageTexture('image.jpg')

// Add Pass 1: Render texture
renderer.addPass({
    name: 'texture_pass',
    shaderCode: textureShader,
    resources: [texture, sampler], // binding 0, 1
})

// Add Pass 2: Post-processing effect
const uniforms = renderer.createUniforms(8) //  Create uniform variable binding

// Get Pass 1 output texture and bind to Pass 2
const texturePassOutput = renderer.getPassTexture('texture_pass')
renderer.addPass({
    name: 'post_process',
    shaderCode: postProcessShader,
    resources: [
        texturePassOutput, 		// @group(0) @binding(0)
        sampler, 				// @group(0) @binding(1)
        uniforms.getBuffer(), 	// @group(0) @binding(2)
    ],
})

// Start loop rendering, can update uniforms in callback
renderer.loopRender((t) => {

    // Update uniforms (Note WebGPU memory alignment rules)
    uniforms.values[0] = canvas.width 		// resolution.x
    uniforms.values[1] = canvas.height 		// resolution.y
    uniforms.values[2] = t / 1000			// time
    uniforms.values[3] = 0 					// padding (leave empty)
    uniforms.values[4] = width 				// textureResolution.x
    uniforms.values[5] = height 			// textureResolution.y
    uniforms.apply() 						// Apply to GPU
})

// Or manually execute single frame render
renderer.renderFrame()
```

## 🎨 Shader Examples

### Pass 1: Texture Rendering

```wgsl
// textureShader
struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) p: vec3<f32>) -> VSOut {
    var o: VSOut;
    o.pos = vec4<f32>(p, 1.0);
    o.uv = p.xy * 0.5 + vec2<f32>(0.5, 0.5);
    o.uv.y = 1.0 - o.uv.y;
    return o;
}

@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(myTexture, mySampler, uv);
}
```

### Pass 2: Brightness & Contrast Adjustment

```wgsl
// postProcessShader
struct Uniforms {
    brightness: f32,  // offset 0
    contrast: f32,    // offset 4
    saturation: f32,  // offset 8
    // 4 bytes padding for vec3 alignment
}

@group(0) @binding(0) var prevTexture: texture_2d<f32>; // Pass 1 output texture
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var color = textureSample(prevTexture, mySampler, uv);

    // Apply brightness
    color.rgb += uniforms.brightness;

    // Apply contrast
    color.rgb = (color.rgb - 0.5) * uniforms.contrast + 0.5;

    // Apply saturation
    let gray = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    color.rgb = mix(vec3<f32>(gray), color.rgb, uniforms.saturation);

    return clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
}
```


## 📋 API

### createWGSLRenderer(canvas, options?)

Create WGSL renderer instance.

```typescript
import { createWGSLRenderer } from 'wgsl-renderer'
const renderer = await createWGSLRenderer(canvas)
```

options:

```ts
interface WGSLRendererOptions { 
    config?: GPUCanvasConfiguration;
}
```

### renderer.addPass(passOptions)

Add a render pass.

```ts
interface RenderPassOptions {
    name: string;
    shaderCode: string;
    entryPoints?: {
        vertex?: string;	// Default is 'vs_main' function
        fragment?: string;	// Default is 'fs_main' function
    };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    resources?: GPUBindingResource[];
    bindGroupSets?: { [setName: string]: GPUBindingResource[] }; // Multiple bind group sets
    view?: GPUTextureView; 		// Optional custom view for this pass
    format?: GPUTextureFormat; 	// Optional format for the view (required when using custom view with different format)
}
```

### renderer.getPassTexture(passName)

Get the output texture of the specified pass. The return value is not a real texture but a placeholder that automatically binds the output texture to the shader during actual rendering.

```typescript
// Get output texture of my_pass
const passOutputTexture = renderer.getPassTexture('my_pass')
const sampler = renderer.createSampler()
renderer.addPass({
    name: 'my_pass2',
    shaderCode: wgslShaderCode,
    resources: [
        passOutputTexture,
        sampler,
    ],
})
```

**Corresponding WGSL binding:**

```wgsl
@group(0) @binding(0) var myTexture: texture_2d<f32>;      // resources[0]
@group(0) @binding(1) var mySampler: sampler;              // resources[1]
```



### renderer.createUniforms(length)

Create uniform variables using Float32Array, length unit is the number of floats.

```typescript
const myUniforms = renderer.createUniforms(8) // 8 floats

// Bind to shader
renderer.addPass({
    name: 'my_pass',
    shaderCode: wgslShaderCode,
    resources: [
        myUniforms.getBuffer(), // group(0) binding(0) var<uniform>
    ],
})

myUniforms.values[0] = 1.0 	// Set value
myUniforms.apply() 			// Apply to GPU
```

### renderer.getContext()

Get WebGPU canvas context.

```typescript
const context = renderer.getContext()
```

### renderer.getDevice()

Get WebGPU device object.

```typescript
const device = renderer.getDevice()
```

### Render Control

#### renderer.renderFrame()
Single frame rendering.

#### renderer.loopRender(callback?)
Built-in loop rendering with per-frame callback for real-time uniform updates.

```typescript
renderer.loopRender(time => {

    // Update uniforms every frame
    myUniforms.values[2] = time * 0.001
    myUniforms.apply()
})
```

#### renderer.stopLoop()
Stop loop rendering.

### Bind Group Switching

The renderer supports switching between different bind group sets at runtime. This is useful for:
- Switching between different textures
- Changing shader parameters dynamically
- Implementing multi-material rendering

#### renderer.switchBindGroupSet(passName, setName)

Switch to a different bind group set for a specific pass.

```typescript
// Add pass with multiple bind group sets
renderer.addPass({
    name: 'main',
    shaderCode: myShader,
    resources: [uniforms, sampler, texture1], // Default resources
    bindGroupSets: {
        'material1': [uniforms, sampler, texture1],
        'material2': [uniforms, sampler, texture2],
        'material3': [uniforms, sampler, texture3],
    }
});

// Switch between materials
renderer.switchBindGroupSet('main', 'material1');
renderer.switchBindGroupSet('main', 'material2');
renderer.switchBindGroupSet('main', 'material3');
```

**Example: Dynamic Texture Switching**

```typescript
// Create multiple textures
const textures = [
    await renderer.loadImageTexture('texture1.png'),
    await renderer.loadImageTexture('texture2.png'),
    await renderer.loadImageTexture('texture3.png'),
];

// Add pass with bind group sets
renderer.addPass({
    name: 'renderer',
    shaderCode: textureShader,
    resources: [uniforms, sampler, textures[0]], // Default
    bindGroupSets: {
        'texture0': [uniforms, sampler, textures[0]],
        'texture1': [uniforms, sampler, textures[1]],
        'texture2': [uniforms, sampler, textures[2]],
    }
});

// User controls
document.getElementById('btn1').onclick = () => {
    renderer.switchBindGroupSet('renderer', 'texture0');
};
document.getElementById('btn2').onclick = () => {
    renderer.switchBindGroupSet('renderer', 'texture1');
};
document.getElementById('btn3').onclick = () => {
    renderer.switchBindGroupSet('renderer', 'texture2');
};
```

#### renderer.updateBindGroupSetResources(passName, setName, resources)

Dynamically update or add a bind group set with new resources. This allows runtime modification of bind groups without recreating the entire pass.

```typescript
// Update a bind group set with new texture
const newTexture = renderer.createTexture({ /* options */ });
renderer.updateBindGroupSetResources('main', 'textureSet', [
    uniforms,
    sampler,
    newTexture,
]);

// Create a new bind group set on the fly
renderer.updateBindGroupSetResources('main', 'newSet', [
    newUniforms,
    newSampler,
    anotherTexture,
]);
renderer.switchBindGroupSet('main', 'newSet');
```

This is useful for:
- Streaming textures in real-time
- Updating shader parameters dynamically
- Creating procedural content at runtime
- Memory-efficient resource management

### renderer.createSampler(options?)

Create sampler with default parameters:

```ts
const options = {
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
}

const sampler = renderer.createSampler(options)
```

## 🎯 Pass Flow

The renderer provides the following management features:

1. **User-defined all Passes**
   - Users have complete control over all resource binding
   - Can get output texture of any pass through `getPassTexture(passName)`
   - Can get pass object through `getPassByName(passName)`

2. **Texture Management**
   - Each pass automatically creates output texture (format: `{passName}_output`)
   - Users can manually bind these textures to other passes
   - The last pass automatically renders to canvas

3. **Complete Flexibility**
   - Users decide binding order and method
   - Support arbitrarily complex pass connections
   - Can create circular dependencies (if needed)

**Example Usage:**
```typescript
// Method 1: Simple chain reference
renderer.addPass({
    name: 'background',
    resources: [bgTexture, sampler1],
})

renderer.addPass({
    name: 'main_effect',
    resources: [renderer.getPassTexture('background'), sampler2], // Reference background output
})

renderer.addPass({
    name: 'post_process',
    resources: [renderer.getPassTexture('main_effect'), sampler3], // Reference main_effect output
})

// Method 2: Complex multi-pass blending
renderer.addPass({ name: 'layer1', resources: [textureA, sampler] })
renderer.addPass({ name: 'layer2', resources: [textureB, sampler] })
renderer.addPass({ name: 'layer3', resources: [textureC, sampler] })

// Create blend pass, referencing multiple different passes simultaneously
const layer1Output = renderer.getPassTexture('layer1')
const layer2Output = renderer.getPassTexture('layer2')
const layer3Output = renderer.getPassTexture('layer3')

renderer.addPass({
    name: 'composite',
    resources: [layer1Output, layer2Output, layer3Output, finalSampler],
})

// Method 3: Dynamic update binding
const mainPass = renderer.getPassByName('main_effect')
if (mainPass) {

    // Dynamically change reference relationship at runtime
    mainPass.updateBindGroup([renderer.getPassTexture('layer1'), newSampler])
}
```

**Error Handling Example:**
```typescript
// If referencing non-existent pass, will throw detailed error during rendering
const invalidTexture = renderer.getPassTexture('nonexistent_pass') // This pass doesn't exist
renderer.addPass({
    name: 'test',
    resources: [invalidTexture, sampler], // Will throw error during rendering
})

// Error message: Cannot find pass named 'nonexistent_pass'. Available passes: [background, main_effect, ...]
```

## 🛠️ Development

```bash
# Development mode
pnpm dev

# Build
pnpm build
```

## 📝 License

MIT License

## 🤝 Contributing

Issues and Pull Requests are welcome!