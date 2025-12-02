import type { InternalRenderPassDescriptor, RenderPassDescriptor, RenderPassOutput } from './RenderPass'
import { RenderPass } from './RenderPass'
import { TextureManager } from './TextureManager'

export interface MultiPassDescriptor {
    passes: RenderPassDescriptor[]; // 用户API
    output?: RenderPassOutput;
}

interface WGSLRendererOptions { backgroundColor?: number | string | { r: number; g: number; b: number; }; }

class WGSLRenderer {
    public ctx!: GPUCanvasContext
    public device!: GPUDevice
    public format!: GPUTextureFormat
    public passes: RenderPass[] = []
    private textureManager!: TextureManager
    private backgroundPassAdded = false
    private backgroundColor: { r: number; g: number; b: number; a: number } = { r: 0.1, g: 0.1, b: 0.1, a: 1 }
    private animationFrameId: number | null = null
    private isResizing = false

    constructor(public canvas: HTMLCanvasElement, options?: WGSLRendererOptions) {
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser.')
        }

        this.ctx = canvas.getContext('webgpu')!

        // Apply user-defined options
        switch (typeof options?.backgroundColor) {
            case 'number':
                const hex = options!.backgroundColor as number
                this.backgroundColor = {
                    r: (hex >> 16 & 0xFF) / 255,
                    g: (hex >> 8 & 0xFF) / 255,
                    b: (hex & 0xFF) / 255,
                    a: 1.0,
                }
                break
            case 'string':
                const str = options!.backgroundColor as string
                const m = str.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
                if (m) {
                    this.backgroundColor = {
                        r: Number.parseInt(m[1], 16) / 255,
                        g: Number.parseInt(m[2], 16) / 255,
                        b: Number.parseInt(m[3], 16) / 255,
                        a: 1.0,
                    }
                }
                break
            case 'object':
                Object.assign(this.backgroundColor, options!.backgroundColor)
                break
        }
    }

    async init() {
        const adapter = await navigator.gpu.requestAdapter()
        this.device = await adapter!.requestDevice()
        this.format = navigator.gpu.getPreferredCanvasFormat()
        this.ctx.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque',
        })

        // Initialize texture manager
        const canvasWidth = this.canvas.width || this.canvas.clientWidth
        const canvasHeight = this.canvas.height || this.canvas.clientHeight
        this.textureManager = new TextureManager(this.device, canvasWidth, canvasHeight)

        this.ensureBackgroundPass()

    }

    public async resize(width: number, height: number) {
        if (this.isResizing) return

        const currentSize = this.textureManager.getPixelSize()
        if (currentSize.width === width && currentSize.height === height) {
            return
        }
        this.isResizing = true

        // Update canvas width/height attributes
        this.canvas.width = width
        this.canvas.height = height

        // Ensure GPU finishes current work before resizing textures
        const future = this.device.queue.onSubmittedWorkDone()

        future.catch(() => {
            this.isResizing = false
        })

        await future

        // Clean up old textures first
        this.textureManager.cleanupOldTextures()

        // Resize textures
        this.textureManager.resize(width, height)

        // Update all bind groups with new texture references
        this.updateAllBindGroups()

        this.isResizing = false
    }

    /**
     * Update bind groups for all passes after texture resize
     */
    private updateAllBindGroups() {

        // First, recreate all necessary textures
        this.recreatePassTextures()

        // Then update all bind groups with new texture references
        this.passes.forEach((pass, index) => {
            const finalBindGroupEntries: GPUBindGroupEntry[] = []

            // Add previous output texture if this is not the first pass
            if (index > 0) {
                const previousOutputTextureName = `pass_${index - 1}_output`
                let previousOutput = this.textureManager.getTexture(previousOutputTextureName)

                if (!previousOutput) {

                    // Create it if it doesn't exist
                    previousOutput = this.textureManager.recreateTexture(previousOutputTextureName, this.format)
                }

                finalBindGroupEntries.push({
                    binding: 0,
                    resource: previousOutput.createView(),
                })
            }

            // Add pass-specific resources
            if (pass.passResources) {
                pass.passResources.forEach((resource, resourceIndex) => {
                    finalBindGroupEntries.push({
                        binding: resourceIndex + 1,
                        resource,
                    })
                })
            }

            // Always update the bind group, even if it's empty (for background pass)
            pass.updateBindGroup(finalBindGroupEntries)
        })
    }

    /**
     * Recreate all pass output textures after resize
     */
    private recreatePassTextures() {

        // Recreate output texture for background pass
        if (this.backgroundPassAdded) {
            this.textureManager.recreateTexture('pass_0_output', this.format)
        }

        // Recreate output textures for all other passes (except the last one)
        this.passes.forEach((pass, index) => {
            if (index < this.passes.length - 1 || pass.hasOutputTexture) {
                const textureName = `pass_${index}_output`
                this.textureManager.recreateTexture(textureName, this.format)
            }
        })
    }

    /**
     * Ensure background pass is added
     */
    private ensureBackgroundPass(): void {
        if (!this.backgroundPassAdded) {
            const backgroundShader = `
                @vertex
                fn vs_main(@location(0) p: vec3<f32>) -> @builtin(position) vec4<f32> {
                    return vec4<f32>(p, 1.0);
                }

                @fragment
                fn fs_main() -> @location(0) vec4<f32> {
                    return vec4<f32>(${this.backgroundColor.r}, ${this.backgroundColor.g}, ${this.backgroundColor.b}, ${this.backgroundColor.a});
                }
            `

            const backgroundPass = new RenderPass(
                {
                    name: 'builtin_background',
                    shaderCode: backgroundShader,
                    blendMode: 'none',
                    clearColor: this.backgroundColor,
                    bindGroupEntries: [], // 内部API，直接提供绑定条目
                },
                this.device,
                this.format,
                'auto',
            )

            // Initialize empty resources array for background pass
            backgroundPass.passResources = []

            this.passes.unshift(backgroundPass)
            this.backgroundPassAdded = true

            // Create output texture for background pass
            const textureName = 'pass_0_output'
            this.textureManager.createTexture(textureName, this.format)
        }
    }

    /**
     * Add a render pass to the multi-pass pipeline
     */
    addPass(descriptor: RenderPassDescriptor): void {
        const finalBindGroupEntries: GPUBindGroupEntry[] = []
        if (this.passes.length > 0) {
            const previousOutput = this.getPassOutput(this.passes.length - 1)
            if (previousOutput) {
                finalBindGroupEntries.push({
                    binding: 0,
                    resource: previousOutput.createView(),
                })
            }
        }

        descriptor.resources.forEach((resource, index) => {
            finalBindGroupEntries.push({
                binding: index + 1,
                resource,
            })
        })

        const internalDescriptor: InternalRenderPassDescriptor = {
            name: descriptor.name,
            shaderCode: descriptor.shaderCode,
            clearColor: descriptor.clearColor,
            blendMode: descriptor.blendMode,
            bindGroupEntries: finalBindGroupEntries,
        }

        const pass = new RenderPass(
            internalDescriptor,
            this.device,
            this.format,
            'auto',
        )

        // Store the original resources for later bind group updates
        pass.passResources = [...descriptor.resources]

        this.passes.push(pass)

        // Create output texture for this pass so it can be used by next pass
        const currentPassIndex = this.passes.length - 1
        const textureName = `pass_${currentPassIndex}_output`
        this.textureManager.createTexture(textureName, this.format)

        // Mark this pass as having output texture for getPassOutput logic
        this.passes[currentPassIndex].hasOutputTexture = true
    }

    /**
     * Get the output texture of a specific pass
     */
    getPassOutput(passIndex: number): GPUTexture | undefined {
        if (passIndex < 0 || passIndex >= this.passes.length) {
            return undefined
        }

        // Background pass (index 0) should always have output texture
        // Other passes only have output texture if they are not the last pass OR are marked as having output texture
        if (passIndex !== 0 && passIndex === this.passes.length - 1) {
            const pass = this.passes[passIndex]
            if (!pass?.hasOutputTexture) {

                // Last pass outputs to canvas
                return undefined
            }
        }

        const textureName = `pass_${passIndex}_output`

        return this.textureManager.getTexture(textureName)
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

        const uniformID = Symbol()
        const uniforms = {
            id: uniformID,
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
        const imgBitmap = await createImageBitmap(await res.blob())
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

        const commandEncoder = this.device.createCommandEncoder()

        // Execute all passes
        for (let i = 0; i < this.passes.length; i++) {
            const pass = this.passes[i]

            // Determine render target
            let renderTarget: GPUTextureView
            let loadOp: GPULoadOp = 'clear'

            if (i === this.passes.length - 1) {

                // Last pass - render to canvas
                renderTarget = this.ctx.getCurrentTexture().createView()
            }
            else {

                // Intermediate pass - render to texture
                const textureName = `pass_${i}_output`
                const texture = this.textureManager.getTexture(textureName)
                if (!texture) continue
                renderTarget = texture.createView()
                loadOp = 'load' // Don't clear intermediate textures for blending
            }

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: renderTarget,
                    loadOp: i === 0 ? 'clear' : loadOp,
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

    public loopRender(cb?: { (): void }) {
        cb?.()
        this.renderFrame()
        this.animationFrameId = requestAnimationFrame(() => this.loopRender(cb))
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
