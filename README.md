# WGSL Multi-Pass Renderer

一个基于WebGPU和WGSL的多通道渲染器。

## ✨ 特性

- 🔗 **自动Pass链** - Binding 0自动绑定到上一个pass的输出
- 🖼️ **多Pass渲染** - 支持背景、纹理渲染、后处理效果等多通道
- ⚡ **高性能渲染循环** - 支持单帧渲染和循环渲染模式
- 🛠️ **TypeScript支持** - 完整的类型定义和清晰的API分离
- 🎮 **Uniform系统** - 内置uniform buffer管理，支持动态参数

## 🚀 快速开始

### 安装

```bash
npm i wgls-renderer
```

### 基础使用

```typescript
import { createWGSLRenderer } from 'wgls-renderer';

const canvas = document.getElementById('canvas');
const renderer = await createWGSLRenderer(canvas, {
    backgroundColor: 0x66CCFF  // 支持多种格式：0xRRGGBB, "#RRGGBB", {r, g, b}
});

// 创建采样器
const sampler = renderer.createSampler();

// 加载纹理
const { texture } = await renderer.loadTexture('image.jpg');

// 添加Pass 1: 渲染纹理
renderer.addPass({
    name: 'texture_pass',
    shaderCode: textureShader,
    blendMode: 'alpha',
    resources: [texture.createView(), sampler]  // binding 1, 2
});

// 添加Pass 2: 后处理效果
const uniforms = renderer.createUniforms(4);  // time, resolution.x, resolution.y, padding
renderer.addPass({
    name: 'post_process',
    shaderCode: postProcessShader,
    blendMode: 'alpha',
    resources: [sampler, uniforms.getBuffer()]  // binding 1, 2
});

// 启动循环渲染，支持uniforms更新
renderer.loopRender(() => {
    // 更新uniforms
    uniforms.values[0] = performance.now() / 1000.0;  // 时间
    uniforms.values[1] = canvas.width;               // 分辨率
    uniforms.values[2] = canvas.height;
    uniforms.apply();
});

// 或者单帧渲染
renderer.renderFrame();
```

## 📋 API

### createWGSLRenderer(canvas, options?)

创建WGSL渲染器实例。

```typescript
const renderer = await createWGSLRenderer(canvas, {
    backgroundColor: 0x66CCFF  // 支持多种格式
});
```


- `number`: 十六进制颜色 `0xRRGGBB`
- `string`: 十六进制字符串 `"#RRGGBB"`
- `object`: RGB对象 `{r: 0-1, g: 0-1, b: 0-1}`

### 渲染控制

#### renderFrame()
单帧渲染，不循环。

```typescript
renderer.renderFrame();
```

#### loopRender(callback?)
循环渲染，支持每帧回调，可用于时时更新uniforms。

```typescript
renderer.loopRender(() => {
    // 每帧更新uniforms
    myUniforms.values[0] = performance.now() / 1000.0;
    myUniforms.apply();
});
```

#### stopLoop()
停止循环渲染。

```typescript
renderer.stopLoop();
```

### addPass(descriptor)

添加一个渲染通道。

```typescript
renderer.addPass({
    name: 'my_pass',
    shaderCode: wgslShaderCode,
    blendMode: 'alpha',
    resources: [textureView, sampler]  // 资源数组
});
```

**资源数组绑定规则:**
- **Binding 0**: 自动绑定到上一个pass的输出（无需在数组中指定）
- **Binding 1**: `resources[0]`
- **Binding 2**: `resources[1]`
- 以此类推...

**对应的WGSL绑定:**
```wgsl
@group(0) @binding(0) var prevTexture: texture_2d<f32>;     // 自动
@group(0) @binding(1) var myTexture: texture_2d<f32>;      // resources[0]
@group(0) @binding(2) var mySampler: sampler;              // resources[1]
```

### Uniform

#### createUniforms(length)
创建uniform buffer管理对象。

```typescript
const uniforms = renderer.createUniforms(4);  // 4个float
uniforms.values[0] = 1.0;                    // 设置值
uniforms.apply();                            // 应用到GPU
const buffer = uniforms.getBuffer();         // 获取GPUBuffer
```

#### getUniformsByID(id)
通过symbol ID获取uniform对象。

```typescript
const uniform = renderer.getUniformsByID(myUniformSymbol);
```

## 🎨 着色器示例

### Pass 1: 纹理渲染

```wgsl
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

@group(0) @binding(0) var prevTexture: texture_2d<f32>; // 内置的纯色背景纹理
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var mySampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let bgColor = textureSample(prevTexture, mySampler, uv);
    let texColor = textureSample(myTexture, mySampler, uv);

    // 背景与纹理混合
    return vec4<f32>(
        bgColor.r * (1.0 - texColor.a) + texColor.r * texColor.a,
        bgColor.g * (1.0 - texColor.a) + texColor.g * texColor.a,
        bgColor.b * (1.0 - texColor.a) + texColor.b * texColor.a,
        1.0
    );
}
```

### Pass 2: 动态后处理效果

```wgsl
struct Uniforms {
    time: f32,
    resolution: vec2<f32>,
}

@group(0) @binding(0) var prevTexture: texture_2d<f32>; // Pass 1的输出纹理
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

## 🔧 内置方法

### 纹理相关

```typescript
// 加载纹理
const { texture, width, height } = await renderer.loadTexture('image.png');

// 创建采样器
const sampler = renderer.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
});

// 创建纹理绑定
const textureView = renderer.createTextureBinding(texture);
```

### 控制相关

```typescript
// 调整画布大小
renderer.resize(800, 600);

// 停止渲染
renderer.stopLoop();
```

## 🎯 Pass流程

渲染器自动管理以下pass流程：

1. **Background Pass** (内置)
   - 渲染纯色背景
   - 输出到 `pass_0_output`

2. **User Pass 1**
   - Binding 0: 背景输出
   - Binding 1+: 用户资源
   - 输出到 `pass_1_output`

3. **User Pass 2**
   - Binding 0: Pass 1输出
   - Binding 1+: 用户资源
   - 输出到 `pass_2_output`

4. **Final Pass**
   - Binding 0: 上一个pass输出
   - 渲染到canvas

## 📁 项目结构

```
src/
├── index.ts              # 主渲染器类，包含完整的API
├── RenderPass.ts          # Pass渲染逻辑和类型定义
├── TextureManager.ts      # 纹理管理
examples/
└── multi-pass-demo.html  # 完整示例，包含纹理、动态uniforms效果
```

## 🛠️ 开发

```bash
# 开发模式
npm run dev

# 构建
npm run build

# 类型检查
npm run type-check
```

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！