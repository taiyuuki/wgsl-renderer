
export const PASS_TEXTURE_REF_SYMBOL = Symbol('PassTextureRef')

export class PassTextureRef {
    public readonly [PASS_TEXTURE_REF_SYMBOL] = true
    public readonly passName: string
    public readonly options?: {
        format?: GPUTextureFormat;
        mipmaps?: boolean;
        sampleCount?: number;
        usage?: GPUTextureUsageFlags;
    }

    constructor(passName: string, options?: {
        format?: GPUTextureFormat;
        mipmaps?: boolean;
        sampleCount?: number;
        usage?: GPUTextureUsageFlags;
    }) {
        this.passName = passName
        this.options = options
    }

    static is(obj: any): obj is PassTextureRef {
        return obj && typeof obj === 'object' && PASS_TEXTURE_REF_SYMBOL in obj
    }

    static fromGPUBindingResource(resource: GPUBindingResource): PassTextureRef | null {
        if (this.is(resource)) {
            return resource
        }

        return null
    }

    static create(passName: string, options?: {
        format?: GPUTextureFormat;
        mipmaps?: boolean;
        sampleCount?: number;
        usage?: GPUTextureUsageFlags;
    }): PassTextureRef {
        return new PassTextureRef(passName, options)
    }
}

export function isPassTextureRef(obj: any): obj is PassTextureRef {
    return PassTextureRef.is(obj)
}
