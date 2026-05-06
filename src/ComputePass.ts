import type { BindingResource } from './RenderPass'

export interface ComputeDispatchSize {
    x:  number;
    y?: number;
    z?: number;
}

export type ComputeDispatchResolver = (context: {
    width:    number;
    height:   number;
    passName: string;
}) => ComputeDispatchSize

export interface ComputePassOptions {
    name:           string;
    shaderCode:     string;
    entryPoint?:    string;
    resources?:     BindingResource[];
    bindGroupSets?: { [setName: string]: BindingResource[] };
    dispatch:       ComputeDispatchResolver | ComputeDispatchSize;
}

export interface InternalComputePassDescriptor {
    name:             string;
    shaderCode:       string;
    entryPoint?:      string;
    bindGroupEntries: {
        binding:  number;
        resource: BindingResource;
    }[];
    bindGroupSets?: { [setName: string]: BindingResource[] };
    dispatch:       ComputePassOptions['dispatch'];
}

export class ComputePass {
    public readonly passType = 'compute'
    public name:               string
    public pipeline:           GPUComputePipeline
    public bindGroup:          GPUBindGroup | null
    public passResources:      BindingResource[] = []
    public bindGroups:         { [setName: string]: GPUBindGroup } = {}
    public activeBindGroupSet: string = 'default'
    public enabled:            boolean = true
    public descriptor:         InternalComputePassDescriptor
    public compilationInfo:    Promise<GPUCompilationInfo>
    public dispatch:           ComputePassOptions['dispatch']
    private device:            GPUDevice

    constructor(
        descriptor: InternalComputePassDescriptor,
        device: GPUDevice,
        layout: GPUPipelineLayout | 'auto' = 'auto',
    ) {
        this.device = device
        this.descriptor = descriptor
        this.name = descriptor.name
        this.dispatch = descriptor.dispatch

        const module = this.device.createShaderModule({
            code:  descriptor.shaderCode,
            label: `Compute shader for ${descriptor.name}`,
        })
        this.compilationInfo = module.getCompilationInfo()

        const entryPoint = descriptor.entryPoint || 'cs_main'
        this.pipeline = this.device.createComputePipeline({
            layout,
            compute: {
                module,
                entryPoint,
            },
        })

        this.bindGroup = null
    }

    public updateBindGroup(newEntries: {
        binding:  number;
        resource: GPUBindingResource;
    }[]) {
        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
        this.bindGroup = this.device.createBindGroup({
            layout:  bindGroupLayout,
            entries: newEntries,
        })
        this.bindGroups.default = this.bindGroup
    }

    public switchBindGroupSet(setName: string): void {
        if (this.bindGroups[setName]) {
            this.activeBindGroupSet = setName
            this.bindGroup = this.bindGroups[setName]
        }
        else if (this.descriptor.bindGroupSets?.[setName]) {

            // Allow switching before first frame.
            // The bind group will be created in renderer.updateBindGroups().
            this.activeBindGroupSet = setName
        }
        else {
            throw new Error(`Bind group set '${setName}' not found. Available sets: ${Object.keys(this.bindGroups).join(', ')}`)
        }
    }

    public getActiveBindGroup(): GPUBindGroup | null {
        return this.bindGroups[this.activeBindGroupSet] || this.bindGroup
    }

    public getBindGroupSets(): string[] {
        return Object.keys(this.bindGroups)
    }

    public updateBindGroupSetResources(setName: string, resources: BindingResource[]) {
        const entries: {
            binding:  number;
            resource: GPUBindingResource;
        }[] = []

        resources.forEach((resource, index) => {
            if (resource) {
                entries.push({
                    binding:  index,
                    resource: resource as GPUBindingResource,
                })
            }
        })

        const bindGroupLayout = this.pipeline.getBindGroupLayout(0)
        this.bindGroups[setName] = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries,
        })

        if (this.activeBindGroupSet === setName) {
            this.bindGroup = this.bindGroups[setName]
        }
    }
}
