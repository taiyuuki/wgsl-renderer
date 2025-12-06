import type { PassTextureRef } from './PassTextureRef'

export type BandingResource = GPUBindingResource | PassTextureRef
export type BindingEntry = {
    binding: number,
    resource: BandingResource,
}

export interface RenderPassOptions {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    resources?: BandingResource[];
    bindGroupSets?: { [setName: string]: BandingResource[] }; // Multiple bind group sets
    view?: GPUTextureView; // Optional custom view for this pass
    format?: GPUTextureFormat; // Optional format for the view (required when using custom view with different format)
}

export interface InternalRenderPassDescriptor {
    name: string;
    shaderCode: string;
    entryPoints?: { vertex?: string; fragment?: string };
    clearColor?: { r: number; g: number; b: number; a: number };
    blendMode?: 'additive' | 'alpha' | 'multiply' | 'none';
    bindGroupEntries: BindingEntry[];
    bindGroupSets?: { [setName: string]: BandingResource[] };
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
    public passResources: BandingResource[] = []
    public bindGroups: { [setName: string]: GPUBindGroup } = {} // Multiple bind groups
    public activeBindGroupSet: string = 'default' // Current active bind group set
    private device: GPUDevice
    public descriptor: InternalRenderPassDescriptor // Store the descriptor
    public enabled: boolean = true // Whether this pass is enabled for rendering

    constructor(
        descriptor: InternalRenderPassDescriptor,
        device: GPUDevice,
        format: GPUTextureFormat,
        layout: GPUPipelineLayout | 'auto',
    ) {
        this.device = device
        this.descriptor = descriptor // Store descriptor
        this.name = descriptor.name
        this.clearColor = descriptor.clearColor || { r: 0, g: 0, b: 0, a: 1 }
        this.blendMode = descriptor.blendMode || 'none'
        this.view = descriptor.view
        this.format = descriptor.format

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
    public updateBindGroupSetResources(setName: string, resources: BandingResource[]) {
        const entries: {
            binding: number;
            resource: GPUBindingResource;
        }[] = []

        resources.forEach((resource, index) => {
            if (resource) {

                // We need to resolve the resource here
                // For simplicity, we'll assume it's already a GPUBindingResource
                // PassTextureRef should be handled at the renderer level
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
