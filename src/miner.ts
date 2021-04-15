import Block from './block'
import { MinerConfig, defaultConfig } from './config'
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

	constructor(cfg: MinerConfig = defaultConfig) {
		super()

		this.cfg = {
			...defaultConfig,
			...cfg
		}
	}

	obtainLatestBlock(): Block {
		return this.blockchain[this.blockchain.length - 1]
	}

	async mine(options: MiningOptions = {
			count: 1,
			startDate: new Date()
		}): Promise<number> {
		if (!options.startDate) options.startDate = new Date()
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
		block.hash = block.computeHash()
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
		if (path.startsWith('/')) path = path.substring(1)

		const entry = REQ_MAP[path]
		if (!entry) {
			throw new Error(`Invalid request path: /${path}`)
		}
		try {
				let json = entry.method === 'POST' ? (options.json || {}) : undefined
				if (json && entry.auth) json = {
					...json,
					id: this.cfg.auth.id,
					key: this.cfg.auth.key
				}
				const resp = await got[entry.method.toLowerCase()]<any>(`${this.cfg.instance}/${path}`, {
					...options,
					responseType: 'json',
					json
				})

				if (resp.body.type !== entry.responseStatus) {
					throw new Error('Invalid response type')
				}

				return resp.body.data
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
