const h = require('virtual-dom/h')
const diff = require('virtual-dom/diff')
const patch = require('virtual-dom/patch')
const createElement = require('virtual-dom/create-element') 

module.exports = setupRenderer


function setupRenderer(){
  let tree = h('div')
  let rootNode = createElement(tree)
  document.body.appendChild(rootNode)

  return updateDom

  function updateDom(newTree){
    const patches = diff(tree, newTree)
    rootNode = patch(rootNode, patches)
    tree = newTree
  }
}