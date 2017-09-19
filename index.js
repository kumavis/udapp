const metamask = require('metamascara')
const h = require('virtual-dom/h')
const treeify = require('treeify').asTree
const ObsStore = require('obs-store')
const ComposedStore = require('obs-store/lib/composed')
const EthQuery = require('eth-query')
const EthStore = require('eth-store')
const EthAbi = require('ethjs-abi')
const EthBlockTracker = require('eth-block-tracker')
const setupRenderer = require('./setupRenderer')
const exampleAbi = require('./token.json')

const defaultState = {
  abi: exampleAbi,
  view: { address: '0x6810e776880c02933d47db1b9fc05908e5386b96' },
}

window.addEventListener('load', function() {

  const provider = metamask.createDefaultProvider({})
  startApp(provider)

})

function startApp(provider){

  const ethQuery = global.ethQuery = new EthQuery(provider)

  const blockTracker = new EthBlockTracker({ provider })
  blockTracker.on('block', (block) => console.log('block #'+Number(block.number)))
  blockTracker.start()

  // setup eth-store (blockchain state)
  const ethStore = global.ethStore = new EthStore(blockTracker, provider)

  // abi-store
  const abiStore = global.abiStore = new ObsStore()

  // view store (in query params)
  const viewStore = global.viewStore = new ObsStore()

  // auxillary data store (not in query params)
  const auxStore = global.auxStore = new ObsStore()

  // root app store
  const appStore = global.appStore = new ComposedStore({
    abi: abiStore,
    view: viewStore,
    eth: ethStore,
    aux: auxStore,
  })

  // actions
  const actions = {
    setAddress: (address) => viewStore.updateState({ address }),
    setFromAddress: (fromAddress) => auxStore.updateState({ fromAddress }),
    setAbi: (abi) => abiStore.putState(abi),
    refreshEthStore: (key) => ethStore._updateForBlock(blockTracker.getCurrentBlock()),
    execute: (method) => {
      const args = readArgumentsFromDom(method)
      try {
        const appState = appStore.getState()
        const toAddress = appState.view.address
        const fromAddress = appState.aux.fromAddress

        console.log('encode:', method.name, args)
        const txData = EthAbi.encodeMethod(method, args)
        const payload = {
          id: 1,
          method: 'eth_sendTransaction',
          params: [{
            from: fromAddress,
            to: toAddress,
            data: txData,
          }],
        }
        console.log('exec:', method.name, args, payload)
        provider.sendAsync(payload, console.log)
      } catch (err) {
        console.warn(err)
      }
    }
  }

  // poll for latest account
  refreshAddress()
  function refreshAddress() {
    ethQuery.accounts((err, accounts) => {
      if (err) throw err
      const newAccount = accounts[0]
      const currentAccount = auxStore.getState().fromAddress
      if (newAccount === currentAccount) return
      actions.setFromAddress(newAccount)
    })
    setTimeout(refreshAddress, 1000)
  }

  // load initial state from hash location
  const initState = Object.assign({}, defaultState, getHashLocationState())
  abiStore.putState(initState.abi)
  viewStore.putState(initState.view)

  // setup dom
  const updateDom = setupRenderer()
  appStore.subscribe(renderApp)
  renderApp(appStore.getState())

  // setup abi -> eth-store syncing
  abiStore.subscribe(updateEthStoreSubs)
  viewStore.subscribe(updateEthStoreSubs)
  updateEthStoreSubs()

  // sync app state with hash location
  appStore.subscribe((appState) => {
    const { view, abi } = appState
    const hashState = { view, abi }
    setHashLocationState(hashState)
  })

  function renderApp(appState) {
    updateDom(render(appState, actions))
  }

  function updateEthStoreSubs(){
    subscribeEthStoreToAbi(appStore.getState(), ethStore)
  }

}

// helpers

function subscribeEthStoreToAbi(appState, ethStore) {
  try {
    ethStore.clear()
    const abi = appState.abi
    const toAddress = appState.view.address
    const fromAddress = appState.aux.fromAddress
    const methods = abi.filter((interface) => interface.type === 'function')
    // const methodsWithNoArgs = methods.filter((interface) => interface.inputs.length === 0)

    // subscribe to method result
    methods.forEach((method) => {

      ethStore.put(method.name, getPayload)

      function getPayload(block){
        const args = readArgumentsFromDom(method)
        try {
          const txData = EthAbi.encodeMethod(method, args)
          // console.log(method.name, 'getPayload:', args)
          return {
            method: 'eth_call',
            params: [{
              from: fromAddress,
              to: toAddress,
              data: txData,
            }, block ? block.number : 'latest'],
          }
        } catch (err) {
          if (args.filter(Boolean).length !== args.length) return
          console.warn(err)
        }
      }
    })
  } catch(err) {
    console.error(err)
  }
}

// function setAddress(address){
//   appState.address = address
//   location.hash = address
// }

function readArgumentsFromDom(method){
  return method.inputs.map((arg, index) => {
    const el = document.getElementById(`${method.name}-${index}`)
    if (!el) return
    const isArray = (arg.type.slice(-2) === '[]')
    if (isArray) {
      try {
        return JSON.parse(el.value)
      } catch (err) {
        return el.value
      }
    }
    return el.value
  })
}

// template

function render(appState, actions){
  var events = (appState.abi || []).filter((interface) => interface.type === 'event')
  var methods = (appState.abi || []).filter((interface) => interface.type === 'function')
  var methodsWithNoArgs = methods.filter((interface) => interface.inputs.length === 0)
  var methodsWithArgs = methods.filter((interface) => interface.inputs.length > 0)

  return h('.container', [
    h('.row', [
      h('.col-sm-12 .col-md-10', [
        h('.col-sm-2', [
          h('h1', 'U-Dapp'),
        ]),
        h('.col-sm-10', [
          h('h2', 'A Universal Front-End For Decentralized Applications'),
        ]),
      ]),
      h('.col-sm-12 .col-md-10', [
        h('form .form-horizontal', [
          h('.form-group', [
            h('label .control-label .col-sm-2', {
              for: 'abi',
            }, 'Contract ABI:'),
            h('.col-sm-10', [
              h('textarea .form-control', {
                rows: '10',
                id: 'abi',
                value: appState.abi ? JSON.stringify(appState.abi) : '',
                placeholder: 'abi goes here',
                onkeyup: (event) => actions.setAbi(JSON.parse(event.target.value)),
                onchange: (event) => actions.setAbi(JSON.parse(event.target.value)),
              })
            ])
          ]),
          // h('textarea', {
          //   value: treeify(appState.abi, true),
          //   disabled: true,
          // }),
          h('.form-group', [
            h('label .control-label .col-sm-2', {
              for: 'address',
            }, 'Contract Address:'),
            h('.col-sm-10', [
              h('input .form-control', {
                id: 'address',
                value: appState.view.address,
                onkeyup: (event) => actions.setAddress(event.target.value),
                onchange: (event) => actions.setAddress(event.target.value),
              })
            ])
          ]),
          h('.form-group', [
            h('label .control-label .col-sm-2', {
              for: 'events',
            }, 'Events:'),
            h('.col-sm-10', [
              h('ul .list-group', [
                h('li .list-group-item', {},
                  events.map(function(interface){
                    return h('div', interface.name)
                  })
                )
              ])
            ])
          ]),
          h('.form-group', [
            h('label .control-label .col-sm-2', {
              for: 'methods1',
            }, 'Methods With No Arguments:'),
            h('.col-sm-10', [
              h('ul .list-group', {
                id: 'methods1',
                }, methodsWithNoArgs.map((interface) => renderMethod(interface, appState.eth, actions))
              )
            ])
          ]),
          h('.form-group', [
            h('label .control-label .col-sm-2', {
              for: 'methods2',
            }, 'Methods With Arguments:'),
            h('.col-sm-10', [
              h('ul .list-group', {
                id: 'methods2',
                }, methodsWithArgs.map((interface) => renderMethod(interface, appState.eth, actions))
              )
            ])
          ])
        ])
      ])
    ])
  ])
}

function renderMethod(interface, ethState, actions){
  const outputs = interface.outputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const inputs = interface.inputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const rawOutput = ethState[interface.name]
  const decodedValues = rawOutput ? decodeAbiOutput(interface, rawOutput) : null

  return (
    h('li .list-group-item', [
      h('label .method-label .control-label', `${interface.name}( ${inputs} ): ${outputs} -> ${decodedValues}`),
      h('.method-form', interface.inputs.map((arg, index) => (
        h('.input-group', [
          h(`span.input-label.input-group-addon`, arg.name),
          h(`input.form-control.input-type-${arg.type}`, {
            id: `${interface.name}-${index}`,
            placeholder: `${arg.type}`,
            onchange: () => actions.refreshEthStore(interface.name),
          }),
        ])
      ))),
      interface.constant ? null : (
        h('button', {
          onclick: () => actions.execute(interface),
        }, 'exec')
      ),
    ])
  )
}

// util

function decodeAbiOutput(interface, rawOutput){
  const result = EthAbi.decodeMethod(interface, rawOutput)
  result.length = interface.outputs.length
  const resultArray = [].slice.call(result)
  return resultArray
}

function getHashLocationState(){
  const hashLocation = decodeURIComponent(location.hash.slice(1))
  const initState = hashLocation ? JSON.parse(hashLocation) : {}
  return initState
}

function setHashLocationState(state){
  location.hash = JSON.stringify(state)
}
