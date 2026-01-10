import type { BindingEntry, BindingResource, InternalRenderPassDescriptor, RenderPassOptions } from './RenderPass'
import { RenderPass } from './RenderPass'
import { TextureManager } from './TextureManager'
import { PassTextureRef, createSamplingView, isPassTextureRef } from './PassTextureRef'

enum RenderMode {
    NORMAL = 'normal', // 正常模式：渲染到canvas和outputTexture
    EXPORT = 'export', // 导出模式：只渲染到outputTexture，不渲染到canvas
}

interface WGSLRendererOptions { config?: Partial<GPUCanvasConfiguration>; }

export interface Uniforms {
    values: Float32Array;
    apply: { (): void };
    getBuffer: { (): GPUBuffer };
}

class WGSLRenderer {
    private ctx!: GPUCanvasContext
    private device!: GPUDevice
    private format!: GPUTextureFormat
    private passes: RenderPass[] = []
    private textureManager!: TextureManager
    private animationFrameId: number | null = null
    private isResizing = false

    // 渲染模式：NORMAL模式渲染到canvas和outputTexture，EXPORT模式只渲染到outputTexture
    private renderMode: RenderMode = RenderMode.NORMAL

    // 用于快速读取像素数据的缓冲区
    private readBuffer: GPUBuffer | null = null

    // 跟踪当前帧是否已经清除过canvas（用于多图层渲染）
    private hasClearedCanvasThisFrame = false

    constructor(public canvas: HTMLCanvasElement, public options?: WGSLRendererOptions) {
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser.')
        }

        this.ctx = canvas.getContext('webgpu')!

    }

    async init() {
        const adapter = await navigator.gpu.requestAdapter()
        this.device = await adapter!.requestDevice()
        this.format = navigator.gpu.getPreferredCanvasFormat() 

        const config = Object.assign({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque',
        }, this.options?.config)
        this.ctx.configure(config)

        // Initialize texture manager
        const canvasWidth = this.canvas.width || this.canvas.clientWidth
        const canvasHeight = this.canvas.height || this.canvas.clientHeight
        this.textureManager = new TextureManager(this.device, canvasWidth, canvasHeight)
    }

    public async resize(width: number, height: number) {
        if (this.isResizing) return

        if (this.canvas.width === width && this.canvas.height === height) {
            return
        }
        this.isResizing = true

        // Update canvas width/height attributes
        this.canvas.width = width
        this.canvas.height = height

        this.canvas.style.width = `${width / (window.devicePixelRatio || 1)}px`
        this.canvas.style.height = `${height / (window.devicePixelRatio || 1)}px`

        // Ensure GPU finishes current work before resizing textures
        const future = this.device.queue.onSubmittedWorkDone()

        future.catch(() => {
            console.warn('GPU work submission failed during resize.')
            this.isResizing = false
        })

        await future

        // Resize texture manager (this destroys all existing textures)
        this.textureManager.resize(width, height)

        this.isResizing = false
    }

    /**
     * 设置渲染模式
     * @param mode NORMAL模式渲染到canvas和outputTexture，EXPORT模式只渲染到outputTexture
     */
    public setRenderMode(mode: RenderMode): void {
        this.renderMode = mode
    }

    /**
     * 获取当前渲染模式
     */
    public getRenderMode(): RenderMode {
        return this.renderMode
    }

    public getContext(): GPUCanvasContext {
        return this.ctx
    }

    public getDevice(): GPUDevice {
        return this.device
    }
    
    /**
     * Get texture reference by pass name
     * Returns a PassTextureRef that will resolve to the actual texture at render time
     *
     * @param passName Name of the pass to reference
     * @param options Optional texture creation options for when the texture needs to be created
     */
    public getPassTexture(
        passName: string,
        options?: {
            format?: GPUTextureFormat;
            mipmaps?: boolean;
            usage?: GPUTextureUsageFlags;
            mipLevelCount?: number;
        },
    ): PassTextureRef {

        // const pass = this.passes.find(pass => pass.name === passName)
        // if (!pass) {
        //     throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        // }
        // const f = options?.format ?? 'rgba8unorm'

        // if (pass.format && f !== pass.format) {
        //     throw new Error(`Format must be set to ${pass.format}, pass name: '${passName}'`)
        // }

        return PassTextureRef.create(passName, options)
    }

    /**
     * Resolve a PassTextureRef to actual GPUTextureView with validation
     */
    public resolveTextureRef(ref: PassTextureRef): GPUTextureView {

        // Find the target pass by name
        const targetPass = this.passes.find(pass => pass.name === ref.passName)
        if (!targetPass) {
            throw new Error(`Cannot find pass named '${ref.passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        // If the pass has a custom view, return it
        if (targetPass.view) {
            return targetPass.view
        }

        // Otherwise, use the auto-generated texture
        const targetPassIndex = this.passes.indexOf(targetPass)
        const textureName = `pass_${targetPassIndex}_output`
        let texture = this.textureManager.getTexture(textureName)

        if (!texture) {

            // Use TextureManager to create texture for consistency
            // The format should match what the render pass expects
            const targetPass = this.passes.find(pass => pass.name === ref.passName)
            const format = targetPass?.format || this.format

            texture = this.textureManager.createTexture(textureName, format, ref.options?.mipLevelCount)
        }

        // Create view - render attachments must always use mipLevelCount: 1
        // but the texture itself can have multiple mip levels for sampling
        const view = texture.createView({
            baseMipLevel: 0,
            mipLevelCount: 1, // Render attachments can only use one mip level
        })

        return view
    }

    /**
     * Get pass by name
     */
    public getPassByName(passName: string): RenderPass | undefined {
        return this.passes.find(pass => pass.name === passName)
    }

    /**
     * Get the raw GPUTexture for a pass (useful for creating custom views)
     * Note: The returned texture should not be used directly as a render attachment
     * with mipLevelCount > 1, as that's not allowed by WebGPU.
     */
    public getPassTextureRaw(passName: string): GPUTexture | null {
        const targetPass = this.passes.find(pass => pass.name === passName)
        if (!targetPass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        const targetPassIndex = this.passes.indexOf(targetPass)
        const textureName = `pass_${targetPassIndex}_output`
        const texture = this.textureManager.getTexture(textureName)

        if (texture) {
            return texture
        }

        return null
    }

    /**
     * Disable a render pass (it will be skipped during rendering)
     */
    public disablePass(passName: string): void {
        const pass = this.getPassByName(passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }
        pass.enabled = false
    }

    /**
     * Enable a render pass
     */
    public enablePass(passName: string): void {
        const pass = this.getPassByName(passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }
        pass.enabled = true
    }

    /**
     * Check if a pass is enabled
     */
    public isPassEnabled(passName: string): boolean {
        const pass = this.getPassByName(passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        return pass.enabled
    }

    /**
     * Remove a render pass permanently
     */
    public removePass(passName: string): boolean {
        const index = this.passes.findIndex(pass => pass.name === passName)
        if (index !== -1) {
            this.passes.splice(index, 1)

            return true
        }

        return false
    }

    /**
     * Get all passes (enabled and disabled)
     */
    public getAllPasses(): RenderPass[] {
        return [...this.passes]
    }

    /**
     * Get only enabled passes
     */
    public getEnabledPasses(): RenderPass[] {
        return this.passes.filter(pass => pass.enabled)
    }

    /**
     * Set the entire passes array (replaces existing passes)
     */
    public setPasses(passes: RenderPass[]): void {
        this.passes = passes
    }

    /**
     * Switch bind group set for a specific pass
     */
    public switchBindGroupSet(passName: string, setName: string): void {
        const pass = this.getPassByName(passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }
        pass.switchBindGroupSet(setName)
    }

    /**
     * Update bind group set resources for a specific pass
     * This allows dynamic modification of bind groups at runtime
     */
    public updateBindGroupSetResources(passName: string, setName: string, resources: BindingResource[]): void {
        const pass = this.getPassByName(passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        // Resolve PassTextureRef if needed
        const resolvedResources = resources.map(resource => {
            if (resource && isPassTextureRef(resource)) {
                return this.resolveResource(resource)
            }

            return resource
        })

        pass.updateBindGroupSetResources(setName, resolvedResources as GPUBindingResource[])
    }

    private createPass(descriptor: RenderPassOptions) {
        const finalBindGroupEntries: BindingEntry[] = []

        // PassTextureRef will be resolved in updateBindGroups when we know the pass index
        descriptor.resources?.forEach((resource, index) => {
            finalBindGroupEntries.push({
                binding: index,
                resource: resource, // Store raw resources first
            })
        })

        // Deep copy bindGroupSets to avoid reference issues
        let bindGroupSetsCopy: { [setName: string]: BindingResource[] } | undefined = undefined
        if (descriptor.bindGroupSets) {
            bindGroupSetsCopy = {}
            for (const [setName, resources] of Object.entries(descriptor.bindGroupSets)) {
                bindGroupSetsCopy[setName] = [...resources]
            }
        }

        const internalDescriptor: InternalRenderPassDescriptor = {
            name: descriptor.name,
            shaderCode: descriptor.shaderCode,
            entryPoints: descriptor.entryPoints,
            clearColor: descriptor.clearColor,
            blendMode: descriptor.blendMode,
            bindGroupEntries: finalBindGroupEntries,
            bindGroupSets: bindGroupSetsCopy, // Store copied bindGroupSets
            view: descriptor.view,
            format: descriptor.format,
            renderToCanvas: descriptor.renderToCanvas,
        }

        const pipelineFormat = descriptor.format || this.format

        return new RenderPass(
            internalDescriptor,
            this.device,
            pipelineFormat,
        )
    }
    
    /**
     * Add a render pass to the multi-pass pipeline
     */
    public addPass(descriptor: RenderPassOptions) {

        const pass = this.createPass(descriptor)
        pass.passResources = descriptor.resources ?? []
        this.passes.push(pass)
    }

    /**
     * Validate all shader compilations
     * Call this after adding all passes to check for shader errors
     * @returns Promise that resolves if all shaders compiled successfully, rejects with compilation errors
     */
    public async validateShaders() {
        const validations = this.passes.map(pass =>
            pass.compilationInfo.then(info => {
                if (info.messages.length > 0) {
                    let errMsg = ''
                    for (const msg of info.messages) {
                        errMsg += `[WGSL ${msg.type}] Shader compilation failed for pass ${pass.name} (${msg.lineNum}:${msg.linePos}): ${msg.message}\n`
                    }
                    throw new Error(errMsg)
                }
            }))

        await Promise.all(validations)

        // Test render one frame to catch binding errors
        this.device.pushErrorScope('validation')

        let renderError: Error | null = null
        try {
            this.renderFrame()
        }
        catch(e) {
            renderError = e as Error
        }

        // Wait for GPU to finish and pop error scope
        const error = await this.device.popErrorScope()

        // If there's a GPU validation error, throw it
        if (error) {
            throw new Error(`Binding/validation error: ${error.message}`)
        }

        // If there's a JavaScript error from renderFrame, throw it
        if (renderError) {
            throw renderError
        }
    }

    public insertPassesTo(passName: string, descriptors: RenderPassOptions[]) {
        const i = this.passes.findIndex(p => p.name === passName)
        if (i === -1) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }
        const newPasses = descriptors.map(desc => {
            const pass = this.createPass(desc)
            pass.passResources = desc.resources ?? []

            return pass
        })
        this.passes.splice(i, 0, ...newPasses)
    }

    /**
     * Resolve resource to actual GPU binding resource
     * Handles PassTextureRef by getting the current texture view with validation
     */
    private resolveResource(resource: BindingResource): GPUBindingResource {

        // Use type-safe check for PassTextureRef
        if (isPassTextureRef(resource)) {
            return this.resolveTextureRef(resource) // This will throw if there's an error
        }

        // Return resource as-is for all other types
        return resource
    }

    /**
     * Update bind groups to resolve current texture references
     * Call this before rendering to ensure all PassTextureRef are resolved
     */
    private updateBindGroups() {
        this.passes.forEach(pass => {

            // Update default bind group
            const finalBindGroupEntries: {
                binding: number;
                resource: GPUBindingResource;
            }[] = []

            pass.passResources.forEach((resource, index) => {
                if (resource) {
                    finalBindGroupEntries.push({
                        binding: index,
                        resource: this.resolveResource(resource),
                    })
                }
            })

            pass.updateBindGroup(finalBindGroupEntries)
        })
    }
    
    /**
     * Create a uniforms
     * @param length The length of the uniform buffer in number of floats
     * @return The uniform object containing the buffer and data array
     */
    public createUniforms(length: number): Uniforms {
        const values = new Float32Array(Math.ceil(length))
        const buffer = this.device.createBuffer({
            size: values.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })

        const uniforms = {
            values,
            apply: () => {
                this.device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength)
            },
            getBuffer: () => buffer,
        }

        return uniforms
    }

    /**
     * Create a sampler
     */
    createSampler(options?: GPUSamplerDescriptor): GPUSampler {
        return this.device.createSampler(Object.assign({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        }, options))
    }

    async loadImageTexture(image: Blob | string, format?: GPUTextureFormat, options?: ImageBitmapOptions) {
        if (typeof image === 'string') {
            if (image.startsWith('data:')) {

                const base64Data = image.split(',')[1]
                const binaryString = atob(base64Data)   
                const len = binaryString.length
                const bytes = new Uint8Array(len)
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i)
                }
    
                image = new Blob([bytes], { type: 'application/octet-stream' })
            }
            else {

                const resp = fetch(image)
                resp.catch(err => {
                    console.error('Failed to load texture:', err)
                })
                const res = await resp
                image = await res.blob()
            }
        }

        const future = createImageBitmap(image, options)
        future.catch(err => {
            console.error('Failed to load texture:', err)
        })
        const imgBitmap = await future

        const texture = this.device.createTexture({
            size: [imgBitmap.width, imgBitmap.height, 1],
            format: format || 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })

        this.device.queue.copyExternalImageToTexture(
            { source: imgBitmap },
            { texture: texture },
            [imgBitmap.width, imgBitmap.height],
        )

        return {
            texture,
            bitMap: imgBitmap,
            width: imgBitmap.width,
            height: imgBitmap.height,
        }
    }

    /**
     * Render all enabled passes
     */
    public renderFrame() {
        if (this.passes.length === 0) return

        // Get only enabled passes for rendering
        const enabledPasses = this.getEnabledPasses()
        if (enabledPasses.length === 0) return

        // 重置canvas清除标志
        this.hasClearedCanvasThisFrame = false

        // Update bind groups each frame like the working implementation
        this.updateBindGroups()

        const commandEncoder = this.device.createCommandEncoder()

        const canvasWidth = this.canvas.width || this.canvas.clientWidth
        const canvasHeight = this.canvas.height || this.canvas.clientHeight

        // Execute all enabled passes
        for (let i = 0; i < enabledPasses.length; i++) {
            const pass = enabledPasses[i]

            let loadOp: GPULoadOp = 'load'
            const isFirst = i === 0
            const isLastPass = i === enabledPasses.length - 1

            if (isFirst) {

                // First pass - clear
                loadOp = 'clear'
            }

            // 确定渲染目标
            let renderTargetView: GPUTextureView
            let isRenderingToCanvas = false

            if (pass.view) {

                // 使用自定义view
                renderTargetView = pass.view
            }
            else if (this.renderMode === RenderMode.EXPORT && (pass.renderToCanvas || isLastPass)) {

                // EXPORT模式且是最后一个pass（或设置了renderToCanvas）：渲染到outputTexture
                const outputTexture = this.textureManager.getOrCreateOutputTexture(
                    canvasWidth,
                    canvasHeight,
                    this.format,
                )
                renderTargetView = outputTexture.createView()

                // 对于outputTexture，只有第一次渲染时才clear
                if (this.hasClearedCanvasThisFrame) {
                    if (loadOp === 'clear') {
                        loadOp = 'load'
                    }
                }
                else {

                    // 第一次渲染到outputTexture，标记为已清除
                    if (loadOp === 'load') {
                        loadOp = 'clear'
                    }
                    this.hasClearedCanvasThisFrame = true
                }
            }
            else if (pass.renderToCanvas || isLastPass) {

                // NORMAL模式：渲染到canvas
                const canvasTexture = this.ctx.getCurrentTexture()
                renderTargetView = canvasTexture.createView()
                isRenderingToCanvas = true
            }
            else {

                // 渲染到临时纹理（pass_i_output），用于多pass链式渲染
                const textureName = `pass_${i}_output`
                let texture = this.textureManager.getTexture(textureName)
                if (!texture) {
                    texture = this.textureManager.createTexture(textureName, pass.format || this.format)
                }
                renderTargetView = texture.createView()
            }

            // 如果渲染到canvas，检查是否需要清除
            if (isRenderingToCanvas) {
                if (this.hasClearedCanvasThisFrame) {

                    // Canvas已经清除过了，使用load保留之前的内容
                    // 如果原来的loadOp是clear，改为load
                    if (loadOp === 'clear') {
                        loadOp = 'load'
                    }
                }
                else {

                    // 第一次渲染到canvas，需要清除
                    // 如果原来的loadOp是load，改为clear
                    if (loadOp === 'load') {
                        loadOp = 'clear'
                    }
                    this.hasClearedCanvasThisFrame = true
                }
            }

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: renderTargetView,
                    loadOp,
                    storeOp: 'store' as GPUStoreOp,
                    clearValue: pass.clearColor,
                }],
            })

            renderPass.setPipeline(pass.pipeline)
            const activeBindGroup = pass.getActiveBindGroup()
            if (activeBindGroup) {
                renderPass.setBindGroup(0, activeBindGroup)
            }
            renderPass.setVertexBuffer(0, pass.vertexBuffer)
            renderPass.draw(3, 1, 0, 0)
            renderPass.end()
        }

        this.device.queue.submit([commandEncoder.finish()])
    }

    public loopRender(cb?: { (t: number): void }) {

        this.animationFrameId = requestAnimationFrame(t => {
            cb?.(t)
            this.renderFrame()
            this.loopRender(cb)
        })
    }

    public stopLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }
    }

    public reset() {
        this.stopLoop()
        this.passes = []
        this.textureManager.destroy()

        // 清理读取缓冲区
        this.readBuffer?.destroy()
        this.readBuffer = null
    }

    /**
     * 快速捕获当前帧的像素数据
     * 从outputTexture读取，不经过canvas，用于视频导出
     * @returns Uint8Array格式的RGBA像素数据
     */
    public async captureFrameFast(): Promise<Uint8Array> {
        const outputTexture = this.textureManager.getOutputTexture()
        if (!outputTexture) {
            throw new Error('Output texture not available. Please render a frame first.')
        }

        const width = outputTexture.width
        const height = outputTexture.height
        const bytesPerRow = Math.ceil(width * 4 / 256) * 256 // 对齐到256字节
        const bufferSize = bytesPerRow * height

        // 创建或复用读取缓冲区
        if (!this.readBuffer
            || this.readBuffer.size !== bufferSize) {
            this.readBuffer?.destroy()
            this.readBuffer = this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            })
        }

        const commandEncoder = this.device.createCommandEncoder()

        // 复制纹理到缓冲区
        commandEncoder.copyTextureToBuffer(
            { texture: outputTexture },
            {
                buffer: this.readBuffer,
                bytesPerRow,
            },
            [width, height],
        )

        this.device.queue.submit([commandEncoder.finish()])

        // 映射缓冲区并读取数据
        await this.readBuffer.mapAsync(GPUMapMode.READ)

        const mappedBuffer = new Uint8Array(this.readBuffer.getMappedRange().slice(0))

        this.readBuffer.unmap()

        // 提取有效的像素数据（去除padding）
        const pixelData = new Uint8Array(width * height * 4)
        for (let row = 0; row < height; row++) {
            const srcOffset = row * bytesPerRow
            const dstOffset = row * width * 4
            pixelData.set(mappedBuffer.subarray(srcOffset, srcOffset + width * 4), dstOffset)
        }

        return pixelData
    }
}

async function createWGSLRenderer(cvs: HTMLCanvasElement, options?: WGSLRendererOptions): Promise<WGSLRenderer> {
    const renderer = new WGSLRenderer(cvs, options)
    await renderer.init()

    return renderer
}

export {
    createWGSLRenderer,
    WGSLRenderer,
    BindingResource,
    RenderPassOptions,
    PassTextureRef,
    createSamplingView,
    RenderMode,
}
