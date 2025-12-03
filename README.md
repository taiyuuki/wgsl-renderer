# WGSL Multi-Pass Renderer

一个基于WebGPU和WGSL的多通道渲染器。

## ✨ 特性

- 🔗 **灵活的Pass链** - Pass 2开始自动绑定上一个pass的输出
- 🖼️ **多Pass渲染** - 支持纹理渲染、后处理效果等多通道
- ⚡ **高性能渲染循环** - 支持单帧渲染和循环渲染模式
- 🛠️ **TypeScript支持** - 完整的类型定义和清晰的API分离
- 🎮 **Uniform系统** - 内置uniform buffer管理，支持动态参数
- 🔄 **自动Resize** - 内置ResizeObserver自动处理canvas大小变化

## 🚀 快速开始

### 安装

```bash
npm i wgls-renderer
```

### 基础使用

```typescript
import { createWGSLRenderer } from 'wgls-renderer'

const canvas = document.getElementById('canvas')
const renderer = await createWGSLRenderer(canvas)

// 创建采样器
const sampler = renderer.createSampler()

// 加载图片纹理
const { texture } = await renderer.loadImageTexture('image.jpg')

// 添加Pass 1: 渲染纹理
renderer.addPass({
    name: 'texture_pass',
    shaderCode: textureShader,
    blendMode: 'alpha',
    resources: [texture, sampler], // binding 0, 1
})

// 添加Pass 2: 后处理效果 (自动绑定Pass 1的输出到binding 0)
const uniforms = renderer.createUniforms(16) // 支持复杂的uniform结构
renderer.addPass({
    name: 'post_process',
    shaderCode: postProcessShader,
    blendMode: 'alpha',
    resources: [sampler, uniforms.getBuffer()], // 对应binding 1, 2 (binding 0自动绑定到Pass 1的输出)
})

// 启动循环渲染，可以在回调函数中更新uniforms
renderer.loopRender(() => {

    // 更新uniforms (注意WebGPU的内存对齐规则)
    uniforms.values[0] = canvas.width // resolution.x
    uniforms.values[1] = canvas.height // resolution.y
    uniforms.values[2] = performance.now() // time
    uniforms.values[3] = 0 // padding (vec3对齐)
    uniforms.values[4] = 1024 // textureResolution.x
    uniforms.values[5] = 1024 // textureResolution.y
    uniforms.apply()
})

// 或者单帧渲染
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

@group(0) @binding(0) var prevTexture: texture_2d<f32>; // 自动绑定到Pass 1的输出纹理
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

### createUniforms(length)

创建uniform变量，length单位为float数量。

```typescript
const myUniforms = renderer.createUniforms(8) // 8个float
```

### getContext()

获取WebGPU画布上下文。

```typescript
const context = renderer.getContext()
```

### getDevice()

获取WebGPU设备对象。

```typescript
const device = renderer.getDevice()
```

### 渲染控制

#### renderFrame()
单帧渲染，不循环。

```typescript
renderer.renderFrame()
```

#### loopRender(callback?)
循环渲染，支持每帧回调，可用于时时更新uniforms。

```typescript
renderer.loopRender(() => {

    // 每帧更新uniforms
    myUniforms.values[0] = performance.now() / 1000.0
    myUniforms.apply()
})
```

#### stopLoop()
停止循环渲染。

```typescript
renderer.stopLoop()
```

### addPass(descriptor)

添加一个渲染通道。

```typescript
renderer.addPass({
    name: 'my_pass',
    shaderCode: wgslShaderCode,
    blendMode: 'alpha',
    resources: [textureView, sampler], // 资源数组
})
```

**资源数组绑定规则:**

- **Pass 1**: 无自动绑定，完全自由
  - **Binding 0**: `resources[0]`
  - **Binding 1**: `resources[1]`
  - 以此类推...

- **Pass 2及以上**: 自动绑定上一个pass的输出
  - **Binding 0**: 上一个pass的输出纹理（自动）
  - **Binding 1**: `resources[0]`
  - **Binding 2**: `resources[1]`
  - 以此类推...

**对应的WGSL绑定:**

```wgsl
// Pass 1:
@group(0) @binding(0) var myTexture: texture_2d<f32>;      // resources[0]
@group(0) @binding(1) var mySampler: sampler;              // resources[1]

// Pass 2+:
@group(0) @binding(0) var prevTexture: texture_2d<f32>;     // 自动绑定
@group(0) @binding(1) var myTexture: texture_2d<f32>;      // resources[0]
@group(0) @binding(2) var mySampler: sampler;              // resources[1]
```

### Uniform

#### createUniforms(length)
创建uniform buffer管理对象。

```typescript
const uniforms = renderer.createUniforms(4) // 4个float
uniforms.values[0] = 1.0 // 设置值
uniforms.apply() // 应用到GPU
const buffer = uniforms.getBuffer() // 获取GPUBuffer
```

**JavaScript Uniforms设置 (注意内存对齐):**

```javascript
const uniforms = renderer.createUniforms(16) // 64字节
uniforms.values[0] = canvas.width // resolution.x
uniforms.values[1] = canvas.height // resolution.y
uniforms.values[2] = performance.now() // time
uniforms.values[3] = 0 // padding (vec3对齐)
uniforms.values[4] = 1024 // texResolution.x
uniforms.values[5] = 1024 // texResolution.y
uniforms.values[6] = 1.0 // speed
uniforms.values[7] = 0 // padding
uniforms.values[8] = 0 // padding
uniforms.apply()
```

## 🔧 内置方法

### 纹理相关

```typescript
// 从url加载图片纹理
const { texture, width, height } = await renderer.loadImageTexture('image.png')

// 创建采样器
const sampler = renderer.createSampler()

// 绑定到Pass
const textureView = texture.createView()
renderer.addPass({
    name: 'texture-pass',
    shaderCode: shaderCode,
    resources: [
        textureView,
        sampler, 
    ],
})
```

```wgsl
// 如果是Pass 1:
@group(0) @binding(0) var myTexture: texture_2d<f32>;      
@group(0) @binding(1) var mySampler: sampler;

// 如果是Pass 2及以后:
@group(0) @binding(0) var prevTexture: texture_2d<f32>; // 自动绑定，上一个Pass的输出纹理
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var mySampler: sampler;
```

### Uniform变量

```typescript
// 创建uniform buffer，length单位为float数量
const uniforms = renderer.createUniforms(8) // 8个float (32字节)
uniforms.values[0] = 1.0 // 设置第一个float值
uniforms.values[1] = 0.5 // 设置第二个float值
uniforms.values[2] = 0.25 // 设置第三个float值
// 向量值需要内存对齐，这里的offset必须是4的倍数，因此跳过uniforms.values[3]
uniforms.values[4] = 1.0 // texResolution.x
uniforms.values[5] = 1024.0 // texResolution.y

uniforms.apply() // 应用到GPU
const uniformBuffer = uniforms.getBuffer() // 获取GPUBuffer

// 绑定到Pass
renderer.addPass({
    name: 'uniform-pass',
    shaderCode: shaderCode,
    resources: [

        // 数组第0项，Pass 1着色器中对应@group(0) @binding(0)，Pass2及以后的着色器中是@group(0) @binding(1)
        uniformBuffer, 
    ],
})
```

```wgsl
struct Uniforms {
    value1: f32, // 对应 uniforms.values[0]
    value2: f32, // 对应 uniforms.values[1]
    value3: f32, // 对应 uniforms.values[2]
    textureResolution: vec2<f32>, // x, y分别对应 uniforms.values[4], uniforms.values[5]
    // ...
}

// 如果是Pass 1:
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// 如果是Pass 2及以后:
@group(0) @binding(0) var prevTexture: texture_2d<f32>; // 自动绑定，上一个Pass的输出纹理
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
```

### 控制相关

```typescript
// 调整画布大小
renderer.resize(800, 600)

// 停止渲染
renderer.stopLoop()
```

## 🎯 Pass流程

渲染器自动管理以下pass流程：

1. **User Pass 1**
   - 无自动绑定，完全自由
   - Binding 0+: 用户资源
   - 输出到 `pass_0_output`

2. **User Pass 2**
   - Binding 0: Pass 1输出纹理（自动）
   - Binding 1+: 用户资源
   - 输出到 `pass_1_output`

3. **User Pass 3+**
   - Binding 0: 上一个pass输出纹理（自动）
   - Binding 1+: 用户资源
   - 输出到 `pass_N-1_output`

4. **Final Pass**
   - Binding 0: 上一个pass输出纹理（自动）
   - Binding 1+: 用户资源
   - 渲染到canvas

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