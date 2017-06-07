const h = require('virtual-dom/h')
const treeify = require('treeify').asTree
const ObsStore = require('obs-store')
const ComposedStore = require('obs-store/lib/composed')
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

  // Checking if Web3 has been injected by the browser (Mist/MetaMask)
  if (typeof web3 !== 'undefined') {
    startApp(web3.currentProvider)
  } else {
    document.body.innerHTML = 'no web3 found'
  }

})

function startApp(provider){

  const blockTracker = new EthBlockTracker({ provider })
  blockTracker.on('block', (block) => console.log('block #'+Number(block.number)))
  blockTracker.start()

  // abi-store
  const abiStore = global.abiStore = new ObsStore()

  // setup eth-store
  const ethStore = global.ethStore = new EthStore(blockTracker, provider)

  // view store
  const viewStore = global.viewStore = new ObsStore()
  
  // root app store
  const appStore = global.appStore = new ComposedStore({
    abi: abiStore,
    view: viewStore,
    eth: ethStore,
  })

  // actions
  const actions = {
    setAddress: (address) => viewStore.updateState({ address }),
    setAbi: (abi) => abiStore.putState(abi),
    refreshEthStore: (key) => ethStore._updateForBlock(blockTracker.getCurrentBlock()),
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
            params: [{ to: toAddress, data: txData }],
          }
        } catch (err) {
          if (args.filter(Boolean).length !== args.length) return
          console.warn(err)
        }
      }

      function readArgumentsFromDom(method){
        return method.inputs.map((arg, index) => {
          const el = document.getElementById(`${method.name}-${index}`)
          return el && el.value
        })
      }

    })
  } catch(err) {
    console.error(err)
  }
}

function setAddress(address){
  appState.address = address
  location.hash = address
}

// template

function render(appState, actions){
  var events = (appState.abi || []).filter((interface) => interface.type === 'event')
  var methods = (appState.abi || []).filter((interface) => interface.type === 'function')
  var methodsWithNoArgs = methods.filter((interface) => interface.inputs.length === 0)
  var methodsWithArgs = methods.filter((interface) => interface.inputs.length > 0)

  return h('.app-content', [

    h('h3','abi:'),
    h('textarea', {
      value: appState.abi ? JSON.stringify(appState.abi) : '',
      placeholder: 'abi goes here',
      onkeyup: (event) => actions.setAbi(JSON.parse(event.target.value)),
      onchange: (event) => actions.setAbi(JSON.parse(event.target.value)),
    }),
    // h('textarea', {
    //   value: treeify(appState.abi, true),
    //   disabled: true,
    // }),

    h('h3','address:'),
    h('input', {
      value: appState.view.address,
      onkeyup: (event) => actions.setAddress(event.target.value),
      onchange: (event) => actions.setAddress(event.target.value),
    }),

    h('h3','events:'),
    h('div', {},
      events.map(function(interface){
        return h('div', interface.name)
      })
    ),

    h('h3','methodsWithNoArgs:'),
    h('div', {},
      methodsWithNoArgs.map((interface) => renderMethod(interface, appState.eth, actions))
    ),

    h('h3','methodsWithArgs:'),
    h('div', {},
      methodsWithArgs.map((interface) => renderMethod(interface, appState.eth, actions))
    ),

  ])
}

function renderMethod(interface, ethState, actions){
  const outputs = interface.outputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const inputs = interface.inputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const rawOutput = ethState[interface.name]
  const decodedValues = rawOutput ? decodeAbiOutput(interface, rawOutput) : null
  return h('div', [
    h('.method-label', `${interface.name}( ${inputs} ): ${outputs} -> ${decodedValues}`),
    h('.method-form', interface.inputs.map((arg, index) => (
      h('.input-row', [
        h(`label.input-label`, arg.name),
        h(`input.input-type-${arg.type}`, {
          id: `${interface.name}-${index}`,
          onchange: () => actions.refreshEthStore(interface.name),
        }),
      ])
    ))),
    h('br'),
  ])
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