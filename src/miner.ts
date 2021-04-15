import Block from './block'
import { MinerConfig } from './config'
import got from 'got'
import { EventEmitter } from 'events'

interface RequestConfig {
	auth?: boolean
	responseStatus?: string
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
}

const REQ_MAP: Record<string, RequestConfig> = {
	'mine': {
		auth: true,
		responseStatus: 'user:mine',
		method: 'POST'
	},
	'info': {
		auth: false,
		responseStatus: 'general:info',
		method: 'GET'
	}
}

interface ResponseInfo {
	freeBlocks: number
	totalBlocks: number
	ownerBlocks: number
	firstBlock: {
		index: number
		hash: string
		timestamp: string
	}
}

interface MiningOptions {
	count?: number
	startDate?: Date
	endDate?: Date
}

export default class Miner extends EventEmitter {
	private blockchain: Block[] = []
	private diff: number = 4
	private cfg: MinerConfig

	constructor(cfg: MinerConfig) {
		super()

		this.cfg = cfg
	}

	obtainLatestBlock(): Block {
		return this.blockchain[this.blockchain.length - 1]
	}

	async mine(options: MiningOptions = {
			count: 1,
			startDate: new Date()
		}): Promise<number> {
		if (!options.endDate) options.endDate = new Date(options.startDate.getTime() + options.count)

		let currTime = options.startDate.getTime()
		const incTime = (options.endDate.getTime() - options.startDate.getTime()) / options.count
		let owns = 0

		while (options.count > 0) {
			const block = this.addBlock(new Date(currTime))
			currTime += incTime
			options.count--;

			if (await block.verify()) {
				this.emit('block:found', block)
				owns++;
			}
		}

		return owns
	}

	async init(): Promise<void> {
		const resp: ResponseInfo = await this.request('/info')
		const block = new Block(this, resp.firstBlock.index, new Date(resp.firstBlock.timestamp), 'Initial block in chain', '0')
		if (block.hash !== resp.firstBlock.hash) throw new Error('Failed to recreate genesis block')
		this.blockchain.push(block)
	}

	addBlock(date: Date = new Date()): Block {
		const latestBlock = this.obtainLatestBlock()
		const block = new Block(this, latestBlock.index + 1, date, this.diff.toString(), latestBlock.hash)

		block.hash = block.computeHash()
		block.proofOfWork(this.diff)
		this.diff = (this.diff + (block.timestamp.getTime() - latestBlock.timestamp.getTime())) % 63

		this.blockchain.push(block)
		return block
	}

	async request(path: string, options?: any): Promise<any> {
		const inst = got.extend({
			hooks: {
				beforeRequest: [
					(options) => {
						const entry = REQ_MAP[path.replace('/', '')]
						if (!entry) {
							throw new Error(`Invalid request path: ${path}`)
						}

						options.prefixUrl = this.cfg.instance
						options.method = entry.method
						options.responseType = 'json'

						let json = options.json || {}
						if (entry.auth === true) {
							if (!this.cfg.auth) {
								throw new Error('Authentication options must be set')
							}

							json = {
								...json,
								id: this.cfg.auth.id,
								key: this.cfg.auth.key
							}
						}
						options.json = json
					}
				]
			}
		})

		const entry = REQ_MAP[path.replace('/', '')]
		if (!entry) {
			throw new Error(`Invalid request path: ${path}`)
		}
		try {
				const resp = await inst<any>(path, options)

				if (resp.body.type !== entry.responseStatus) {
					throw new Error('Invalid response type')
				}

				return resp.body
		} catch (err) {
			const { response } = err

			if (response && response.body && response.body.status && response.body.type !== entry.responseStatus) {
				err.name = 'MonkeyFlipHTTPError'
				err.message = response.body.detail
			}

			throw err
		}
	}
}
