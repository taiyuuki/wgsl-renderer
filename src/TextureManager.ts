export class TextureManager {
    private textures: Map<string, GPUTexture> = new Map()
    private device: GPUDevice
    private width: number
    private height: number
    private oldTextures: GPUTexture[] = []

    constructor(device: GPUDevice, width: number, height: number) {
        this.device = device
        this.width = width
        this.height = height
    }

    createTexture(name: string, format?: GPUTextureFormat): GPUTexture {
        if (this.textures.has(name)) {
            const oldTexture = this.textures.get(name)!

            // Store old texture for deferred cleanup
            this.oldTextures.push(oldTexture)
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

        this.width = width
        this.height = height

        // Store all current textures for deferred cleanup
        this.textures.forEach(texture => {
            this.oldTextures.push(texture)
        })

        // Store the names of textures to recreate
        this.textures.clear()

    }

    /**
     * Recreate a specific texture with current dimensions
     */
    recreateTexture(name: string, format?: GPUTextureFormat): GPUTexture {
        const texture = this.device.createTexture({
            size: [this.width, this.height],
            format: format || 'bgra8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })

        this.textures.set(name, texture)

        return texture
    }

    /**
     * Clean up old textures that are no longer needed
     * Call this after ensuring GPU work is complete
     */
    cleanupOldTextures() {
        this.oldTextures.forEach(texture => {
            texture.destroy()
        })
        this.oldTextures.length = 0
    }

    destroy() {
        this.textures.forEach(texture => texture.destroy())
        this.textures.clear()

        this.oldTextures.forEach(texture => texture.destroy())
        this.oldTextures.length = 0
    }

    getPixelSize(): { width: number; height: number } {
        return { width: this.width, height: this.height }
    }
}
