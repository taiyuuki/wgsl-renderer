# WGSL Multi-Pass Renderer

一个基于WebGPU和WGSL的多通道渲染器。

## ✨ 特性

- 🖼️ **多Pass渲染** - 支持纹理渲染、后处理效果等自定义多通道渲染
- ⚡ **高性能渲染循环** - 支持单帧渲染和循环渲染模式
- 🛠️ **TypeScript支持** - 完整的类型定义和清晰的API分离
- 🎮 **Uniform系统** - 内置uniform buffer管理，支持动态参数

## 🚀 快速开始

### 安装

```bash
npm i wgls-renderer
```

### 添加渲染通道

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





### 基础多通道使用

```typescript
import { createWGSLRenderer } from 'wgls-renderer'

const canvas = document.getElementById('canvas')
const renderer = await createWGSLRenderer(canvas)

// 创建采样器
const sampler = renderer.createSampler()

// 加载图片纹理
const { texture, width, height } = await renderer.loadImageTexture('image.jpg')

// 添加Pass 1: 渲染纹理
renderer.addPass({
    name: 'texture_pass',
    shaderCode: textureShader,
    resources: [texture, sampler], // binding 0, 1
})

// 添加Pass 2: 后处理效果
const uniforms = renderer.createUniforms(8) //  创建uniform变量的绑定

// 获取Pass 1的输出纹理并绑定到Pass 2
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

// 启动循环渲染，可以在回调函数中更新uniforms
renderer.loopRender((t) => {

    // 更新uniforms (注意WebGPU的内存对齐规则)
    uniforms.values[0] = canvas.width 		// resolution.x
    uniforms.values[1] = canvas.height 		// resolution.y
    uniforms.values[2] = t / 1000       	// time
    uniforms.values[3] = 0 					// padding (留空)
    uniforms.values[4] = width 				// textureResolution.x
    uniforms.values[5] = height 			// textureResolution.y
    uniforms.apply()						// 应用到GPU
})

// 或者手动改执行官单帧渲染
renderer.renderFrame()
```


## 🎨 着色器示例

### Pass 1: 纹理渲染

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

### Pass 2: 动态后处理效果

```wgsl
// postProcessShader
struct Uniforms {
    resolution: vec2<f32>,     // offset 0-7
    time: f32,                 // offset 8
    // 4 bytes padding for vec3 alignment
    texResolution: vec2<f32>,  // offset 16-23
    speed: f32,                // offset 24
    // 8 bytes padding for next vec3
}

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

@group(0) @binding(0) var prevTexture: texture_2d<f32>; // Pass 1输出纹理
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var color = textureSample(prevTexture, mySampler, uv);

    // 动态扫描线效果
    let scanline = 0.8 + 0.2 * sin(uv.y * 600.0 + uniforms.time * 5.0);
    color = vec4<f32>(color.r * scanline, color.g * scanline, color.b * scanline, color.a);

    // 动态波纹效果
    let waveAmplitude = 0.05 + 0.02 * sin(uniforms.time * 2.0);
    let waveX = sin(uv.x * 10.0 + uniforms.time * 3.0) * cos(uv.y * 8.0 + uniforms.time * 2.0) * waveAmplitude;

    let finalR = clamp(color.r + waveX, 0.0, 1.0);
    let finalG = clamp(color.g - waveX * 0.5, 0.0, 1.0);
    let finalB = clamp(color.b + waveX * 0.3, 0.0, 1.0);

    return vec4<f32>(finalR, finalG, finalB, color.a);
}
```

## 📋 API

### createWGSLRenderer(canvas, options?)

创建WGSL渲染器实例。

```typescript
const renderer = await createWGSLRenderer(canvas)
```

options：

```ts
interface WGSLRendererOptions { 
    config?: GPUCanvasConfiguration;
}
```

### renderer.addPass(passOptions)

添加渲染通道。

```ts
interface RenderPassOptions {
    name: string;
    shaderCode: string;
    entryPoints?: { 
        vertex?: string;	// 默认是 'vs_main' 函数
        fragment?: string;	// 默认 'fs_main' 函数
    };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    resources: GPUBindingResource[];
    view?: GPUTextureView; 		// 可选的自定义View
    format?: GPUTextureFormat; 	// 可选的自定义格式（使用自定义View时需要指定格式一致）
}
```

### renderer.getPassTexture(passName)

获取指定通道的输出纹理，返回值并不是真正的纹理，而是一个占位符，只在实际渲染时自动将输出纹理绑定到着色器。

```typescript
// 获取my_pass通道的输出纹理
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

**对应的WGSL绑定:**

```wgsl
@group(0) @binding(0) var myTexture: texture_2d<f32>;      // resources[0]
@group(0) @binding(1) var mySampler: sampler;              // resources[1]
```





### renderer.createUniforms(length)

创建uniform变量，使用Float32Array，length单位是float的数量。

```typescript
const myUniforms = renderer.createUniforms(8) // 8个float

// 绑定到着色器
renderer.addPass({
    name: 'my_pass',
    shaderCode: wgslShaderCode,
    resources: [
        myUniforms.getBuffer(), // group(0) binding(0) var<uniform>
    ],
})

myUniforms.values[0] = 1.0 // 设置值
myUniforms.apply() // 应用到GPU
```

### renderer.getContext()

获取WebGPU画布上下文。

```typescript
const context = renderer.getContext()
```

### renderer.getDevice()

获取WebGPU设备对象。

```typescript
const device = renderer.getDevice()
```

### 渲染控制

#### renderer.renderFrame()
单帧渲染。

#### renderer.loopRender(callback?)
内置的循环渲染，支持每帧回调，可用于实时更新uniforms。

```typescript
renderer.loopRender((time) => {

    // 每帧更新uniforms
    myUniforms.values[2] = time * 0.001
    myUniforms.apply()
})
```

#### renderer.stopLoop()
停止循环渲染。

### renderer.createSampler(options?)

创建采样器，默认参数：

```ts
const options = {
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
}

const sampler = renderer.createSampler(options)
```

## 🎯 Pass流程

渲染器提供以下管理功能：

1. **用户定义所有Pass**
   - 用户完全控制所有资源的绑定
   - 可以通过`getPassTexture(passName)`获取任意pass的输出纹理
   - 可以通过`getPassByName(passName)`获取pass对象

2. **纹理管理**
   - 每个pass自动创建输出纹理（格式：`{passName}_output`）
   - 用户可以手动将这些纹理绑定到其他pass
   - 最后一个pass自动渲染到canvas

3. **完全灵活性**
   - 用户决定绑定顺序和方式
   - 支持任意复杂的pass连接关系
   - 可以创建循环依赖（如果需要的话）

**示例用法：**
```typescript
// 方法1: 简单的链式引用
renderer.addPass({
    name: 'background',
    resources: [bgTexture, sampler1]
})

renderer.addPass({
    name: 'main_effect',
    resources: [renderer.getPassTexture('background'), sampler2]  // 引用background的输出
})

renderer.addPass({
    name: 'post_process',
    resources: [renderer.getPassTexture('main_effect'), sampler3]  // 引用main_effect的输出
})

// 方法2: 复杂的多pass混合
renderer.addPass({ name: 'layer1', resources: [textureA, sampler] })
renderer.addPass({ name: 'layer2', resources: [textureB, sampler] })
renderer.addPass({ name: 'layer3', resources: [textureC, sampler] })

// 创建混合pass，同时引用多个不同的pass
const layer1Output = renderer.getPassTexture('layer1')
const layer2Output = renderer.getPassTexture('layer2')
const layer3Output = renderer.getPassTexture('layer3')

renderer.addPass({
    name: 'composite',
    resources: [layer1Output, layer2Output, layer3Output, finalSampler]
})

// 方法3: 动态更新绑定
const mainPass = renderer.getPassByName('main_effect')
if (mainPass) {
    // 运行时动态改变引用关系
    mainPass.updateBindGroup([renderer.getPassTexture('layer1'), newSampler])
}
```

**错误处理示例：**
```typescript
// 如果引用不存在的pass，会在渲染时抛出详细错误
const invalidTexture = renderer.getPassTexture('nonexistent_pass')  // 这个pass不存在
renderer.addPass({
    name: 'test',
    resources: [invalidTexture, sampler]  // 渲染时会抛出错误
})
// 错误信息: Cannot find pass named 'nonexistent_pass'. Available passes: [background, main_effect, ...]
```

## 🛠️ 开发

```bash
# 开发模式
pnpm dev

# 构建
pnpm build
```

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！