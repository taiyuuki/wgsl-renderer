export class TextureManager {
    private textures: Map<string, GPUTexture> = new Map()
    private device: GPUDevice
    private width: number
    private height: number

    constructor(device: GPUDevice, width: number, height: number) {
        this.device = device
        this.width = width
        this.height = height
    }

    createTexture(name: string, format?: GPUTextureFormat): GPUTexture {

        // Destroy existing texture with same name if it exists
        if (this.textures.has(name)) {
            this.textures.get(name)!.destroy()
        }

        const texture = this.device.createTexture({
            size: [this.width, this.height],
            format: format || 'bgra8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })

        this.textures.set(name, texture)

        return texture
    }

    getTexture(name: string): GPUTexture | undefined {
        return this.textures.get(name)
    }

    resize(width: number, height: number) {
        if (width === this.width && height === this.height) {
            return
        }

        this.width = width
        this.height = height

        // Destroy all existing textures
        this.textures.forEach(texture => {
            texture.destroy()
        })
        this.textures.clear()

        // Textures will be recreated on demand when needed
    }

    destroy() {
        this.textures.forEach(texture => texture.destroy())
        this.textures.clear()
    }

    getPixelSize(): { width: number; height: number } {
        return { width: this.width, height: this.height }
    }
}
