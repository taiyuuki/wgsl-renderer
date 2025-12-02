// 用户API - 简化的资源数组接口
export interface RenderPassDescriptor {
    name: string;
    shaderCode: string;
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    resources: GPUBindingResource[];
}

// 内部API - RenderPass构造函数需要的完整绑定信息
export interface InternalRenderPassDescriptor {
    name: string;
    shaderCode: string;
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    bindGroupEntries: GPUBindGroupEntry[];
}

export interface RenderPassOutput {
    texture?: GPUTexture;
    writeToCanvas?: boolean;
}

export class RenderPass {
    public name: string
    public pipeline: GPURenderPipeline
    public bindGroup: GPUBindGroup
    public vertexBuffer: GPUBuffer
    public clearColor: { r: number; g: number; b: number; a: number }
    public blendMode: 'additive' | 'alpha' | 'multiply' | 'none'
    public hasOutputTexture: boolean = false

    constructor(
        descriptor: InternalRenderPassDescriptor,
        device: GPUDevice,
        format: GPUTextureFormat,
        layout: GPUPipelineLayout | 'auto',
    ) {
        this.name = descriptor.name
        this.clearColor = descriptor.clearColor || { r: 0, g: 0, b: 0, a: 1 }
        this.blendMode = descriptor.blendMode || 'alpha'

        // Create shader module
        const module = device.createShaderModule({ code: descriptor.shaderCode })

        // Create vertex buffer
        this.vertexBuffer = device.createBuffer({
            size: 4 * 3 * 3, // 3 vertices, 3 components, 4 bytes each
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        })

        new Float32Array(this.vertexBuffer.getMappedRange()).set([
            -1, -1, 0,
            3, -1, 0,
            -1, 3, 0,
        ])
        this.vertexBuffer.unmap()

        // Create pipeline
        this.pipeline = device.createRenderPipeline({
            layout: layout,
            vertex: {
                module,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 3 * 4,
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    }],
                }],
            },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{
                    format: format,
                    blend: this.getBlendState(),
                }],
            },
            primitive: { topology: 'triangle-list' },
        })

        // Create bind group
        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)

        this.bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: descriptor.bindGroupEntries || [],
        })
    }

    private getBlendState(): GPUBlendState | undefined {
        switch (this.blendMode) {
            case 'none':
                return undefined
            case 'alpha':
                return {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                }
            case 'additive':
                return {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one',
                        operation: 'add',
                    },
                }
            case 'multiply':
                return {
                    color: {
                        srcFactor: 'src',
                        dstFactor: 'dst',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                }
            default:
                return undefined
        }
    }
}
