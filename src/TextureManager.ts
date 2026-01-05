export class TextureManager {
    private textures: Map<string, GPUTexture> = new Map()
    private device: GPUDevice
    private width: number
    private height: number

    // 用于视频导出的纹理
    private renderTarget: GPUTexture | null = null
    private outputTexture: GPUTexture | null = null

    constructor(device: GPUDevice, width: number, height: number) {
        this.device = device
        this.width = width
        this.height = height
    }

    createTexture(name: string, format?: GPUTextureFormat, mipLevelCount?: number): GPUTexture {

        // Destroy existing texture with same name if it exists
        if (this.textures.has(name)) {
            this.textures.get(name)!.destroy()
        }

        const texture = this.device.createTexture({
            size: [this.width, this.height],
            format: format || 'bgra8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            mipLevelCount: mipLevelCount || 1,
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

    /**
     * Store a texture in the manager
     */
    setTexture(name: string, texture: GPUTexture) {
        this.textures.set(name, texture)
    }

    /**
     * 获取或创建渲染目标纹理
     * 所有渲染到这里的内容会再复制到 canvas 和输出纹理
     * 必须支持 COPY_SRC 以便复制到 canvas 和输出纹理
     */
    getOrCreateRenderTarget(width: number, height: number, format: GPUTextureFormat): GPUTexture {
        if (!this.renderTarget
            || this.renderTarget.width !== width
            || this.renderTarget.height !== height) {

            this.renderTarget?.destroy()

            this.renderTarget = this.device.createTexture({
                size: [width, height, 1],
                format: format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT // 必须支持渲染
                    | GPUTextureUsage.COPY_SRC // 用于复制到canvas和输出纹理
                    | GPUTextureUsage.TEXTURE_BINDING, // 可选，用于采样
            })
        }

        return this.renderTarget
    }

    /**
     * 获取当前渲染目标纹理
     */
    getRenderTarget(): GPUTexture | null {
        return this.renderTarget
    }

    /**
     * 获取或创建输出纹理
     * 用于视频导出，始终包含最新的渲染结果
     */
    getOrCreateOutputTexture(width: number, height: number, format: GPUTextureFormat): GPUTexture {
        if (!this.outputTexture
            || this.outputTexture.width !== width
            || this.outputTexture.height !== height) {

            this.outputTexture?.destroy()

            this.outputTexture = this.device.createTexture({
                size: [width, height, 1],
                format: format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT // 可选，如果需要直接渲染
                    | GPUTextureUsage.COPY_SRC // 用于读取
                    | GPUTextureUsage.TEXTURE_BINDING, // 可选，用于采样
            })
        }

        return this.outputTexture
    }

    /**
     * 获取当前输出纹理
     */
    getOutputTexture(): GPUTexture | null {
        return this.outputTexture
    }

    destroy() {
        this.textures.forEach(texture => texture.destroy())
        this.textures.clear()

        // 清理视频导出相关的纹理
        this.renderTarget?.destroy()
        this.renderTarget = null
        this.outputTexture?.destroy()
        this.outputTexture = null
    }

    getPixelSize(): { width: number; height: number } {
        return { width: this.width, height: this.height }
    }
}
