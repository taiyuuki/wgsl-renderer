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
        if (this.textures.has(name)) {
            this.textures.get(name)!.destroy()
        }

        const texture = this.device.createTexture({
            size: [this.width, this.height],
            format: format || 'bgra8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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

        // Destroy old textures
        this.textures.forEach(texture => texture.destroy())
        this.textures.clear()

        this.width = width
        this.height = height
    }

    destroy() {
        this.textures.forEach(texture => texture.destroy())
        this.textures.clear()
    }

    getPixelSize(): { width: number; height: number } {
        return { width: this.width, height: this.height }
    }
}
