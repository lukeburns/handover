const { util } = require('bns')
const Hip5 = require('hip5')
const Ethereum = require('./ethereum')

const PROTOCOLS = ['_eth', 'eth']

class Plugin extends Hip5 {
  static id = 'handover' // plugin id + logger context

  constructor (node) {
    super(PROTOCOLS, node) // pass string or array of protocols to Hip5 constructor
    this.ready = false
    this.node = node
    this.ethereum = new Ethereum({
      projectId: node.config.str('handover-infura-projectid'),
      projectSecret: node.config.str('handover-infura-projectsecret')
    })
    // Plugin can not operate if node doesn't have DNS resolvers
    if (!this.ns || !this.node.rs) {
      return
    }
  }

  async direct (protocol, name, type) {
    if (protocol === 'eth') {
      const labels = util.split(name)
      if (labels.length < 2) {
        return this.sendSOA()
      }

      const data = await this.ethereum.resolveDnsFromEns(name, type)
      if (data && data.length > 0) {
        return this.sendData(data, type)
      }
    }
  }

  async middleware (protocol, hip5Data, name, type, req, tld, res) {
    // If the recursive is being minimal, don't look up the name.
    // Send the SOA back and get the full query from the recursive .
    const labels = util.split(name)
    if (labels.length < 2) {
      return this.sendSOA()
    }

    this.logger.info('hip5data', hip5Data)

    let data
    switch (protocol) {
      case 'eth':
        data = await this.ethereum.resolveDnsFromEns(name, type, hip5Data+'.eth')
        break
      case '_eth':
        // Look up an alternate (forked) ENS contract by the Ethereum
        // address specified in the NS record
        data = await this.ethereum.resolveDnsFromAbstractEns(name, type, hip5Data)
        break
    }

    if (!data || data.length === 0) {
        return null
    }

    return this.sendData(data, type)
  }
  async open() {
    this.logger.info('handover external network resolver plugin installed.')

    // The first thing this plugin wants to do when it's opened is
    // contact https://mainnet.infura.io/. Of course, if this instance
    // of hsd is being used to resolve DNS for the system it is running on,
    // that is not yet possible at this point in the hsd life cycle!
    // The best we can do is wait for this event from the recursive resolver,
    // and even then we still need to give it another second before we
    // can resolve DNS with... ourself.
    this.node.rs.on('listening', async () => {
      await new Promise(r => setTimeout(r, 1000))
      await this.ethereum.init()
      this.ready = true
      this.logger.info(
        'handover external network resolver plugin is active!'
      )
    })
  }

  close() {
    this.ready = false
  }
}

exports.id = Plugin.id
exports.init = node => new Plugin(node)
