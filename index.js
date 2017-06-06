const h = require('hyperscript')
const treeify = require('treeify').asTree
const exampleAbi = require('./example-abi.json')
const EthStore = require('eth-store')
const EthAbi = require('ethjs-abi')
const EthBlockTracker = require('eth-block-tracker')

window.addEventListener('load', function() {

  // Checking if Web3 has been injected by the browser (Mist/MetaMask)
  if (typeof web3 !== 'undefined') {
    window.web3 = new Web3(web3.currentProvider)
  } else {
    document.body.innerHTML = 'no web3 found'
  }

  // Now you can start your app & access web3 freely:
  startApp(window.web3.currentProvider)

})

function startApp(provider){

  const blockTracker = new EthBlockTracker({ provider })
  blockTracker.on('block', (block) => console.log('block #'+Number(block.number)))
  blockTracker.start()

  const ethStore = window.ethStore = new EthStore(blockTracker, provider)

  const appState = window.appState = {
    address: location.hash.slice(1),
    abi: null,
    rawAbi: JSON.stringify(exampleAbi),
    setAbi: setAbi,
    setAddress: setAddress,
    ethState: ethStore.getState(),
  }

  ethStore.on('update', function(state){
    appState.ethState = state
    didUpate()
  })

  setAbi(JSON.stringify(exampleAbi))

  didUpate()
}

// actions

function setAbi(rawAbi){
  try {
    var abi = appState.abi = JSON.parse(rawAbi)
    var methods = abi.filter((interface) => interface.type === 'function')
    var methodsWithNoArgs = methods.filter((interface) => interface.inputs.length === 0)
    // subscribe to method result
    methodsWithNoArgs.forEach((method)=>{
      var payload = {
        method: 'eth_call',
        params: [{
          to: appState.address,
          data: EthAbi.encodeMethod(method, []),
        }], 
      }
      ethStore.put(method.name, payload)
    })
  } catch(err) {
    console.error(err)
  } finally {
    appState.rawAbi = rawAbi
    didUpate()
  }
}

function setAddress(address){
  appState.address = address
  location.hash = address
  didUpate()
}

// app basics

function didUpate(){
  render(window.appState)
}

function render(props){
  emptyBody()
  var content = renderRoot(props)
  arrayify(content).forEach(function(element){
    document.body.appendChild(element)
  })
}

// template

function renderRoot(props){
  // console.log(treeify(props.abi, true))
  var events = (props.abi || []).filter((interface) => interface.type === 'event')
  var methods = (props.abi || []).filter((interface) => interface.type === 'function')
  var constantMethods = methods.filter((interface) => interface.constant === true)
  var dynamicMethods = methods.filter((interface) => interface.constant === false)
  var methodsWithNoArgs = methods.filter((interface) => interface.inputs.length === 0)
  var methodsWithArgs = methods.filter((interface) => interface.inputs.length > 0)
  // var constantMethodsWithNoArgs = constantMethods.filter((interface) => interface.inputs.length === 0)
  // var constantMethodsWithArgs = constantMethods.filter((interface) => interface.inputs.length > 0)


  return ([

    h('h3','abi:'),
    h('textarea', {
      value: props.rawAbi || '',
      placeholder: 'abi goes here',
      onkeyup: (event) => props.setAbi(event.target.value),
      onchange: (event) => props.setAbi(event.target.value),
    }),
    h('textarea', {
      value: treeify(props.abi, true),
      // disabled: true,
    }),

    h('h3','address:'),
    h('input', {
      value: props.address,
      onkeyup: (event) => props.setAddress(event.target.value),
      onchange: (event) => props.setAddress(event.target.value),
    }),

    h('h3','events:'),
    h('div', {},
      events.map(function(interface){
        return h('div', interface.name)
      })
    ),

    h('h3','methodsWithNoArgs:'),
    h('div', {},
      methodsWithNoArgs.map((interface) => renderNoArgMethod(interface, props.ethState))
    ),

    h('h3','methodsWithArgs:'),
    h('div', {},
      methodsWithArgs.map((interface) => renderArgMethod(interface, props.ethState))
    ),

    // h('h3','dynamicMethods:'),
    // h('div', {},
    //   dynamicMethods.map(function(interface){
    //     return h('div', interface.name)
    //   })
    // ),

  ])
}

function renderNoArgMethod(interface, ethState){
  const outputs = interface.outputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const inputs = interface.inputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const rawOutput = ethState[interface.name]
  const decodedValues = rawOutput ? decodeAbiOutput(interface, rawOutput) : null
  return h('div', `${interface.name}( ${inputs} ): ${outputs} -> ${decodedValues}`)
}

function renderArgMethod(interface, ethState){
  const outputs = interface.outputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const inputs = interface.inputs.map((arg)=>`${arg.type} ${arg.name}`).join(', ')
  const rawOutput = ethState[interface.name]
  const decodedValues = rawOutput ? decodeAbiOutput(interface, rawOutput) : null
  return h('div', `${interface.name}( ${inputs} ): ${outputs} -> ${decodedValues}`)
}

// util

function emptyBody(){
  document.body.innerHTML = ''
}

function arrayify(obj){
  return Array.isArray(obj) ? obj : [obj]
}

function decodeAbiOutput(interface, rawOutput){
  const result = EthAbi.decodeMethod(interface, rawOutput)
  result.length = interface.outputs.length
  const resultArray = [].slice.call(result)
  return resultArray
}