import type { BindingEntry, BindingResource, InternalRenderPassDescriptor, RenderPassOptions } from './RenderPass'
import { RenderPass } from './RenderPass'
import { TextureManager } from './TextureManager'
import { PassTextureRef, isPassTextureRef } from './PassTextureRef'

interface WGSLRendererOptions { config?: GPUCanvasConfiguration; }

class WGSLRenderer {
    private ctx!: GPUCanvasContext
    private device!: GPUDevice
    private format!: GPUTextureFormat
    private passes: RenderPass[] = []
    private textureManager!: TextureManager
    private animationFrameId: number | null = null
    private isResizing = false
    private supportedSampleCounts: number[] = []
    private testedSampleCounts: Set<number> = new Set()

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

        // Initialize supported sample counts with common values
        // We'll test them lazily when actually requested
        this.supportedSampleCounts = [1] // Sample count 1 is always supported
        this.testedSampleCounts = new Set([1]) // Track which sample counts we've tested

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

    public getContext(): GPUCanvasContext {
        return this.ctx
    }

    public getDevice(): GPUDevice {
        return this.device
    }

    public getSupportedSampleCounts(): number[] {
        return [...this.supportedSampleCounts]
    }

    public isSampleCountSupported(sampleCount: number): boolean {

        // If we've already tested this sample count, return the cached result
        if (this.testedSampleCounts.has(sampleCount)) {
            return this.supportedSampleCounts.includes(sampleCount)
        }

        return this.supportedSampleCounts.includes(sampleCount)
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
            sampleCount?: number;
            usage?: GPUTextureUsageFlags;
        },
    ): PassTextureRef {
        const pass = this.passes.find(pass => pass.name === passName)
        if (!pass) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }
        const f = options?.format ?? 'rgba8unorm'
        if (f !== pass.format) {
            throw new Error(`Format must be set to ${pass.format}, pass name: '${passName}'`)
        }

        return PassTextureRef.create(passName, options)
    }

    /**
     * Resolve a PassTextureRef to actual GPUTextureView with validation
     */
    private resolveTextureRef(ref: PassTextureRef): GPUTextureView {

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

            // Create texture if it doesn't exist, using options from getPassTexture
            const format = ref.options?.format || this.format
            const usage = ref.options?.usage
                || GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT

            // Create texture with device to have more control
            const size = this.textureManager.getPixelSize()
            const requestedSampleCount = ref.options?.sampleCount || 1
            const actualSampleCount = this.isSampleCountSupported(requestedSampleCount) ? requestedSampleCount : 1

            texture = this.device.createTexture({
                size: [size.width, size.height],
                format: format,
                usage: usage,
                sampleCount: actualSampleCount,
            })

            // Store in textureManager for tracking
            this.textureManager.setTexture(textureName, texture)
        }

        // Create view with mipmap settings
        const view = texture.createView({
            baseMipLevel: 0,
            mipLevelCount: ref.options?.mipmaps ? texture.mipLevelCount : 1,
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
            sampleCount: descriptor.sampleCount,
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

        // Validate sample count
        if (descriptor.sampleCount && !this.isSampleCountSupported(descriptor.sampleCount)) {
            console.warn(`Sample count ${descriptor.sampleCount} is not supported. Using sample count 1 instead.`)
            descriptor.sampleCount = 1
        }

        const pass = this.createPass(descriptor)
        pass.passResources = descriptor.resources ?? []
        this.passes.push(pass)
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
    public createUniforms(length: number) {
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

    public renderFrame() {
        if (this.passes.length === 0) return

        // Get only enabled passes for rendering
        const enabledPasses = this.getEnabledPasses()
        if (enabledPasses.length === 0) return

        // Update bind groups each frame like the working implementation
        this.updateBindGroups()

        const commandEncoder = this.device.createCommandEncoder()

        // Execute all enabled passes
        for (let i = 0; i < enabledPasses.length; i++) {
            const pass = enabledPasses[i]
           
            let loadOp: GPULoadOp = 'load'
            const isFirst = i === 0

            if (isFirst) {

                // First pass - clear the canvas
                loadOp = 'clear'
            }

            // Determine render target
            let renderTarget: GPUTextureView
            let resolveTarget: GPUTextureView | undefined
            const canvasTexture = this.ctx.getCurrentTexture()
            const isLastPass = i === enabledPasses.length - 1

            if (pass.renderToCanvas || isLastPass && !pass.view) {

                // Render to canvas if explicitly requested or if it's the last pass
                // If MSAA is enabled, we need to render to MSAA texture first then resolve to canvas
                if (pass.sampleCount && pass.sampleCount > 1) {

                    // Validate sample count before creating texture
                    const actualSampleCount = this.isSampleCountSupported(pass.sampleCount) ? pass.sampleCount : 1
 
                    if (actualSampleCount === 1) {

                        // Fall back to direct canvas rendering
                        renderTarget = canvasTexture.createView()
                    }
                    else {

                        // Create MSAA texture for rendering
                        const msaaTexture = this.device.createTexture({
                            size: [canvasTexture.width, canvasTexture.height],
                            format: canvasTexture.format,
                            usage: GPUTextureUsage.RENDER_ATTACHMENT,
                            sampleCount: actualSampleCount,
                        })
                        renderTarget = msaaTexture.createView()
                        resolveTarget = canvasTexture.createView()
                    }
                }
                else {
                    renderTarget = canvasTexture.createView()
                }
            }
            else if (pass.view) {

                // Use custom view
                renderTarget = pass.view
            }
            else {

                // Render to regular texture
                const textureName = `pass_${i}_output`
                let texture = this.textureManager.getTexture(textureName)
                if (texture) {

                    // Check if we have MSAA textures
                    const msaaTexture = this.textureManager.getTexture(`${textureName}_msaa`)
                    const resolveTexture = this.textureManager.getTexture(`${textureName}_resolve`)

                    if (msaaTexture && resolveTexture && pass.sampleCount && pass.sampleCount > 1) {
                        renderTarget = msaaTexture.createView()
                        resolveTarget = resolveTexture.createView()
                    }
                    else {
                        renderTarget = texture.createView()
                    }
                }
                else if (pass.sampleCount && pass.sampleCount > 1) {
                    const actualSampleCount = this.isSampleCountSupported(pass.sampleCount) ? pass.sampleCount : 1
                    if (actualSampleCount > 1) {
                        texture = this.device.createTexture({
                            size: [this.textureManager.getPixelSize().width, this.textureManager.getPixelSize().height],
                            format: pass.format || this.format,
                            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                            sampleCount: actualSampleCount,
                        })

                        // Create corresponding resolve texture
                        const resolveTexture = this.device.createTexture({
                            size: [this.textureManager.getPixelSize().width, this.textureManager.getPixelSize().height],
                            format: pass.format || this.format,
                            usage: GPUTextureUsage.TEXTURE_BINDING,
                            sampleCount: 1,
                        })

                        // Store both textures
                        this.textureManager.setTexture(`${textureName}_msaa`, texture)
                        this.textureManager.setTexture(`${textureName}_resolve`, resolveTexture)

                        renderTarget = texture.createView()
                        resolveTarget = resolveTexture.createView()
                    }
                    else {

                        // Fall back to regular texture rendering
                        texture = this.textureManager.createTexture(textureName, pass.format || this.format)
                        renderTarget = texture.createView()
                    }
                }
                else {
                    texture = this.textureManager.createTexture(textureName, pass.format || this.format)
                    renderTarget = texture.createView()
                }
                
            }

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: renderTarget,
                    resolveTarget: resolveTarget,
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
    }
}

export async function createWGSLRenderer(cvs: HTMLCanvasElement, options?: WGSLRendererOptions): Promise<WGSLRenderer> {
    const renderer = new WGSLRenderer(cvs, options)
    await renderer.init()

    return renderer
}

export {
    WGSLRenderer,
    BindingResource,
    RenderPassOptions,
    PassTextureRef,
}
