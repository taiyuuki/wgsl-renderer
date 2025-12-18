export const PASS_TEXTURE_REF_SYMBOL = Symbol('PassTextureRef')

export class PassTextureRef {
    public readonly [PASS_TEXTURE_REF_SYMBOL] = true
    public readonly passName: string
    public readonly options?: {
        format?: GPUTextureFormat;
        mipmaps?: boolean;
        usage?: GPUTextureUsageFlags;
        mipLevelCount?: number;
    }

    constructor(passName: string, options?: {
        format?: GPUTextureFormat;
        mipmaps?: boolean;
        usage?: GPUTextureUsageFlags;
        mipLevelCount?: number;
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
        usage?: GPUTextureUsageFlags;
        mipLevelCount?: number;
    }): PassTextureRef {
        return new PassTextureRef(passName, options)
    }
}

export function isPassTextureRef(obj: any): obj is PassTextureRef {
    return PassTextureRef.is(obj)
}

/**
 * Create a texture view suitable for sampling (not for render attachments)
 * This view can include multiple mip levels for shader access
 */
export function createSamplingView(texture: GPUTexture, ref: PassTextureRef): GPUTextureView {
    return texture.createView({
        baseMipLevel: 0,
        mipLevelCount: ref.options?.mipmaps ? texture.mipLevelCount : 1,
    })
}
