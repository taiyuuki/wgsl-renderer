
export interface RenderPassOptions {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    resources: GPUBindingResource[];
    view?: GPUTextureView; // Optional custom view for this pass
    format?: GPUTextureFormat; // Optional format for the view (required when using custom view with different format)
}

export interface InternalRenderPassDescriptor {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    bindGroupEntries: GPUBindGroupEntry[];
    view?: GPUTextureView;
    format?: GPUTextureFormat;
}

export class RenderPass {
    public name: string
    public pipeline: GPURenderPipeline
    public bindGroup: GPUBindGroup | null
    public vertexBuffer: GPUBuffer
    public clearColor: { r: number; g: number; b: number; a: number }
    public blendMode: 'additive' | 'alpha' | 'multiply' | 'none'
    public view?: GPUTextureView
    public format?: GPUTextureFormat
    public passResources: GPUBindingResource[] = []
    private device: GPUDevice

    constructor(
        descriptor: InternalRenderPassDescriptor,
        device: GPUDevice,
        format: GPUTextureFormat,
        layout: GPUPipelineLayout | 'auto',
    ) {
        this.device = device
        this.name = descriptor.name
        this.clearColor = descriptor.clearColor || { r: 0, g: 0, b: 0, a: 1 }
        this.blendMode = descriptor.blendMode || 'none'
        this.view = descriptor.view
        this.format = descriptor.format

        // Use custom format if provided, otherwise use default format
        const actualFormat = descriptor.format || format

        // Create shader module
        const module = this.device.createShaderModule({ code: descriptor.shaderCode })

        // Create vertex buffer
        this.vertexBuffer = this.device.createBuffer({
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

        // Use custom entry points if provided, otherwise use defaults
        const vertexEntryPoint = descriptor.entryPoints?.vertex || 'vs_main'
        const fragmentEntryPoint = descriptor.entryPoints?.fragment || 'fs_main'

        // Create pipeline
        this.pipeline = this.device.createRenderPipeline({
            layout: layout,
            vertex: {
                module,
                entryPoint: vertexEntryPoint,
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
                entryPoint: fragmentEntryPoint,
                targets: [{
                    format: actualFormat,
                    blend: this.getBlendState(),
                }],
            },
            primitive: { topology: 'triangle-list' },
        })

        this.bindGroup = null! // Will be set by updateBindGroup
    }

    /**
     * Update bind group with new entries (e.g., after texture resize)
     */
    public updateBindGroup(newEntries: GPUBindGroupEntry[]) {
        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: newEntries,
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
