export interface MinerConfig {
	instance?: string
	auth?: {
		id?: string
		key?: string
	}
	winston?: {
		level?: string
	}
}

const env = process.env.NODE_ENV || 'development'
const production = env === 'production'

const logLevels: Record<string, string> = {
	test: 'error',
	development: 'debug',
	production: 'info'
}

export const defaultConfig = {
	instance: 'https://crypto.monkeyflip.io',
	winston: {
		level: logLevels[env]
	}
}
