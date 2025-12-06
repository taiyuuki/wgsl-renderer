import type { BandingResource, BindingEntry, InternalRenderPassDescriptor, RenderPassOptions } from './RenderPass'
import { RenderPass } from './RenderPass'
import { TextureManager } from './TextureManager'
import { PassTextureRef, isPassTextureRef } from './PassTextureRef'

export interface MultiPassDescriptor { passes: RenderPassOptions[]; }

interface WGSLRendererOptions { config?: GPUCanvasConfiguration; }

class WGSLRenderer {
    private ctx!: GPUCanvasContext
    private device!: GPUDevice
    private format!: GPUTextureFormat
    private passes: RenderPass[] = []
    private textureManager!: TextureManager
    private animationFrameId: number | null = null
    private isResizing = false

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

    /**
     * Get texture reference by pass name
     * Returns a PassTextureRef that will resolve to the actual texture at render time
     */
    public getPassTexture(passName: string): PassTextureRef {
        if (!this.passes.find(pass => pass.name === passName)) {
            throw new Error(`Cannot find pass named '${passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        return PassTextureRef.create(passName)
    }

    /**
     * Resolve a PassTextureRef to actual GPUTextureView with validation
     */
    private resolveTextureRef(ref: PassTextureRef): GPUTextureView {

        // Find the target pass index by name
        const targetPassIndex = this.passes.findIndex(pass => pass.name === ref.passName)
        if (targetPassIndex === -1) {
            throw new Error(`Cannot find pass named '${ref.passName}'. Available passes: [${this.passes.map(p => p.name).join(', ')}]`)
        }

        // Use the correct texture naming convention: pass_${index}_output
        const textureName = `pass_${targetPassIndex}_output`
        let texture = this.textureManager.getTexture(textureName)

        if (!texture) {

            // Create texture if it doesn't exist
            texture = this.textureManager.createTexture(textureName, this.format)
        }

        const view = texture.createView()
        
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
    public updateBindGroupSetResources(passName: string, setName: string, resources: BandingResource[]): void {
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
    
    /**
     * Add a render pass to the multi-pass pipeline
     */
    addPass(descriptor: RenderPassOptions): void {
        const finalBindGroupEntries: BindingEntry[] = []

        // PassTextureRef will be resolved in updateBindGroups when we know the pass index
        descriptor.resources?.forEach((resource, index) => {
            finalBindGroupEntries.push({
                binding: index,
                resource: resource, // Store raw resources first
            })
        })

        // Deep copy bindGroupSets to avoid reference issues
        let bindGroupSetsCopy: { [setName: string]: BandingResource[] } | undefined = undefined
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
        }

        // Use the format specified in descriptor, or default to canvas format
        // Note: For intermediate passes that don't specify format, we'll still use canvas format
        // to avoid compatibility issues
        const pipelineFormat = descriptor.format || this.format

        const pass = new RenderPass(
            internalDescriptor,
            this.device,
            pipelineFormat,
            'auto',
        )

        // Store the original resources for dynamic resolution during render
        pass.passResources = descriptor.resources ?? []

        // Store bind group sets for dynamic resolution
        // Note: bindGroupSets are already stored in the internalDescriptor

        this.passes.push(pass)
    }

    /**
     * Resolve resource to actual GPU binding resource
     * Handles PassTextureRef by getting the current texture view with validation
     */
    private resolveResource(resource: BandingResource): GPUBindingResource {

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

            // Update bind group sets if they exist
            if (pass.descriptor && pass.descriptor.bindGroupSets) {
                for (const [setName, resources] of Object.entries(pass.descriptor.bindGroupSets)) {
                    const entries: {
                        binding: number;
                        resource: GPUBindingResource;
                    }[] = []

                    resources.forEach((resource, index) => {
                        if (resource) {
                            const resolved = this.resolveResource(resource)
                            entries.push({
                                binding: index,
                                resource: resolved,
                            })
                        }
                    })

                    pass.updateBindGroupSet(setName, entries)
                }
            }
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

    async loadImageTexture(image: Blob | string, format?: GPUTextureFormat) {
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

        const future = createImageBitmap(image)
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
            const isLast = i === enabledPasses.length - 1
            
            if (isLast) {

                // Last pass - render to canvas
                loadOp = 'clear' // Clear the canvas on the last pass
            }

            // Determine render target
            let renderTarget: GPUTextureView
            if (pass.view) {
                renderTarget = pass.view
            }
            else if(isLast) {

                renderTarget = this.ctx.getCurrentTexture().createView()
            }
            else {

                // Intermediate pass - render to texture
                const textureName = `pass_${i}_output`
                let texture = this.textureManager.getTexture(textureName)
                if (!texture) {

                    // Create texture with the same format as the pipeline
                    // This ensures format compatibility
                    texture = this.textureManager.createTexture(textureName, pass.format || this.format)
                }
                renderTarget = texture.createView()
            }

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: renderTarget,
                    loadOp,
                    storeOp: 'store',
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
}

export async function createWGSLRenderer(cvs: HTMLCanvasElement, options?: WGSLRendererOptions): Promise<WGSLRenderer> {
    const renderer = new WGSLRenderer(cvs, options)
    await renderer.init()

    return renderer
}

export type { WGSLRenderer }
