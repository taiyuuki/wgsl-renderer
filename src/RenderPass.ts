import type { PassTextureRef } from './PassTextureRef'

export type BindingResource = GPUBindingResource | PassTextureRef
export type BindingEntry = {
    binding: number,
    resource: BindingResource,
}

export type BlendMode
    = 'additive' 
        | 'alpha' 
        | 'darken' 
        | 'difference' 
        | 'exclusion' 
        | 'lighten' 
        | 'linear-burn' 
        | 'linear-dodge' 
        | 'max' 
        | 'min' 
        | 'multiply' 
        | 'none' 
        | 'screen' 
        | 'subtract'

export interface RenderPassOptions {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: BlendMode;
    resources?: BindingResource[];
    bindGroupSets?: { [setName: string]: BindingResource[] }; // Multiple bind group sets
    view?: GPUTextureView; // Optional custom view for this pass
    format?: GPUTextureFormat; // Optional format for the view (required when using custom view with different format)
    renderToCanvas?: boolean; // Optional: force render to canvas
}

export interface InternalRenderPassDescriptor {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: BlendMode;
    bindGroupEntries: BindingEntry[];
    bindGroupSets?: { [setName: string]: BindingResource[] };
    view?: GPUTextureView;
    format?: GPUTextureFormat;
    renderToCanvas?: boolean;
}

export class RenderPass {
    public name: string
    public pipeline: GPURenderPipeline
    public bindGroup: GPUBindGroup | null
    public vertexBuffer: GPUBuffer
    public clearColor: { r: number; g: number; b: number; a: number }
    public blendMode: BlendMode
    public view?: GPUTextureView
    public format?: GPUTextureFormat
    public renderToCanvas?: boolean
    public passResources: BindingResource[] = []
    public bindGroups: { [setName: string]: GPUBindGroup } = {} // Multiple bind groups
    public activeBindGroupSet: string = 'default' // Current active bind group set
    private device: GPUDevice
    public descriptor: InternalRenderPassDescriptor // Store the descriptor
    public enabled: boolean = true // Whether this pass is enabled for rendering

    constructor(
        descriptor: InternalRenderPassDescriptor,
        device: GPUDevice,
        format: GPUTextureFormat,
        layout: GPUPipelineLayout | 'auto' = 'auto',
    ) {
        this.device = device
        this.descriptor = descriptor // Store descriptor
        this.name = descriptor.name
        this.clearColor = descriptor.clearColor || { r: 0, g: 0, b: 0, a: 1 }
        this.blendMode = descriptor.blendMode || 'none'
        this.view = descriptor.view
        this.format = descriptor.format
        this.renderToCanvas = descriptor.renderToCanvas

        // Use custom format if provided, otherwise use default format
        const actualFormat = descriptor.format || format

        // Create shader module
        const module = this.device.createShaderModule({
            code: descriptor.shaderCode,
            label: `Shader for ${descriptor.name}`,
        })

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
                        format: 'float32x3' as GPUVertexFormat,
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
    public updateBindGroup(newEntries: {
        binding: number;
        resource: GPUBindingResource;
    }[]) {
        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: newEntries,
        })

        // Also update the default bind group set
        this.bindGroups.default = this.bindGroup
    }

    /**
     * Update a specific bind group set with new entries
     */
    public updateBindGroupSet(setName: string, newEntries: {
        binding: number;
        resource: GPUBindingResource;
    }[]) {

        // Only create if it doesn't exist or if this is the first time
        if (!this.bindGroups[setName]) {
            const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
            this.bindGroups[setName] = this.device.createBindGroup({
                layout: bindGroupLayout,
                entries: newEntries,
            })
        }
    }

    /**
     * Switch to a different bind group set
     */
    public switchBindGroupSet(setName: string): void {
        if (this.bindGroups[setName]) {
            this.activeBindGroupSet = setName
            this.bindGroup = this.bindGroups[setName]
        }
        else {
            throw new Error(`Bind group set '${setName}' not found. Available sets: ${Object.keys(this.bindGroups).join(', ')}`)
        }
    }

    /**
     * Get the current active bind group
     */
    public getActiveBindGroup(): GPUBindGroup | null {
        return this.bindGroups[this.activeBindGroupSet] || this.bindGroup
    }

    /**
     * Get all available bind group set names
     */
    public getBindGroupSets(): string[] {
        return Object.keys(this.bindGroups)
    }

    /**
     * Update or add a bind group set with new resources
     * This allows dynamic modification of bind groups at runtime
     */
    public updateBindGroupSetResources(setName: string, resources: BindingResource[]) {
        const entries: {
            binding: number;
            resource: GPUBindingResource;
        }[] = []

        resources.forEach((resource, index) => {
            if (resource) {
                entries.push({
                    binding: index,
                    resource: resource as GPUBindingResource,
                })
            }
        })

        // Create or replace the bind group
        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
        this.bindGroups[setName] = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: entries,
        })

        // If this is the active set, update the current bindGroup
        if (this.activeBindGroupSet === setName) {
            this.bindGroup = this.bindGroups[setName]
        }
    }

    private getBlendState(): GPUBlendState | undefined {
        switch (this.blendMode) {
            case 'none':
                return undefined

            case 'alpha':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            case 'additive':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                    },
                }

            case 'multiply':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'zero',
                        dstFactor: 'src',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'zero',
                        dstFactor: 'src-alpha',
                    },
                }

            case 'screen':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            case 'subtract':
                return {
                    color: {
                        operation: 'reverse-subtract',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'reverse-subtract',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                    },
                }

            case 'min':
                return {
                    color: {
                        operation: 'min',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'min',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                }

            case 'max':
                return {
                    color: {
                        operation: 'max',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'max',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                }

            case 'darken':
                return {
                    color: {
                        operation: 'min',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            case 'lighten':
                return {
                    color: {
                        operation: 'max',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }
            
            case 'linear-dodge':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one',
                    },
                }

            case 'linear-burn':
                return {
                    color: {
                        operation: 'reverse-subtract',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            case 'difference':
                return {
                    color: {
                        operation: 'reverse-subtract',
                        srcFactor: 'one',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            case 'exclusion':
                return {
                    color: {
                        operation: 'add',
                        srcFactor: 'zero',
                        dstFactor: 'one',
                    },
                    alpha: {
                        operation: 'add',
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                    },
                }

            default:
                return undefined
        }
    }
}
