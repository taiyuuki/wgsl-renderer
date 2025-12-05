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

        const internalDescriptor: InternalRenderPassDescriptor = {
            name: descriptor.name,
            shaderCode: descriptor.shaderCode,
            entryPoints: descriptor.entryPoints,
            clearColor: descriptor.clearColor,
            blendMode: descriptor.blendMode,
            bindGroupEntries: finalBindGroupEntries,
            view: descriptor.view,
            format: descriptor.format,
        }

        const pipelineFormat = descriptor.format || this.format
        
        const pass = new RenderPass(
            internalDescriptor,
            this.device,
            pipelineFormat,
            'auto',
        )

        // Store the original resources for dynamic resolution during render
        pass.passResources = descriptor.resources ?? []

        this.passes.push(pass)
    }

    /**
     * Resolve resource to actual GPU binding resource
     * Handles PassTextureRef by getting the current texture view with validation
     */
    private resolveResource(resource: BandingResource): BandingResource {

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
            const finalBindGroupEntries: BindingEntry[] = []

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

    async loadImageTexture(url: string) {
        const resp = fetch(url)
        resp.catch(err => {
            console.error('Failed to load texture:', err)
        })
        const res = await resp

        const future = createImageBitmap(await res.blob())
        future.catch(err => {
            console.error('Failed to load texture:', err)
        })
        const imgBitmap = await future
        
        const texture = this.device.createTexture({
            size: [imgBitmap.width, imgBitmap.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })

        this.device.queue.copyExternalImageToTexture(
            { source: imgBitmap },
            { texture: texture },
            [imgBitmap.width, imgBitmap.height],
        )

        return {
            texture,
            width: imgBitmap.width,
            height: imgBitmap.height,
        }
    }

    public renderFrame() {
        if (this.passes.length === 0) return

        // Update bind groups each frame like the working implementation
        this.updateBindGroups()

        const commandEncoder = this.device.createCommandEncoder()

        // Execute all passes
        for (let i = 0; i < this.passes.length; i++) {
            const pass = this.passes[i]
           
            let loadOp: GPULoadOp = 'load'
            const isLast = i === this.passes.length - 1
            
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

                    // Create texture if it doesn't exist - use rgba16float for better precision
                    texture = this.textureManager.createTexture(textureName, 'rgba16float')
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
            if (pass.bindGroup) {
                renderPass.setBindGroup(0, pass.bindGroup)
            }
            renderPass.setVertexBuffer(0, pass.vertexBuffer)
            renderPass.draw(3, 1, 0, 0)
            renderPass.end()
        }

        this.device.queue.submit([commandEncoder.finish()])
    }

    public loopRender(cb?: { (t?: number): void }) {

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
