/**
 * @file visitor
 * transform 'ESM import' syntax to a customized syntax:
 * @author alienzhou
 */

const t = require('babel-types');
const template = require('babel-template');
const Sync_Func = '__my_require__';
const Async_Func = '__my_require__';
const Async_Func_Attr = 'async';
const External_Scheme = /^runtime:/;

/* using template instead of origin type functions */
const namespaceTemplate = template(`
    var LOCAL = ${Sync_Func}(MODULE_NAME);
`);

const commonTemplate = template(`
    var LOCAL = ${Sync_Func}(MODULE_NAME)[IMPORTED];
`);

const defaultTemplate = template(`
    var LOCAL = ${Sync_Func}(MODULE_NAME)['default'];
`);

const sideTemplate = template(`
    ${Sync_Func}(MODULE_NAME);
`);
/* ********************************************** */

// store the specifiers in one importDeclaration
let specifiers = [];

/********************************************************************************/
/*************************** visitor for babel plugin ***************************/
/********************************************************************************/
const specifierVisitor = {
    ImportNamespaceSpecifier(_path) {
        let data = {
            type: 'NAMESPACE',
            local: _path.node.local.name
        };

        this.specifiers.push(data);
    },

    ImportSpecifier(_path) {
        let data = {
            type: 'COMMON',
            local: _path.node.local.name,
            imported: _path.node.imported ? _path.node.imported.name : null
        };

        this.specifiers.push(data);
    },

    ImportDefaultSpecifier(_path) {
        let data = {
            type: 'DEFAULT',
            local: _path.node.local.name
        };

        this.specifiers.push(data);
    }
}

/**
 * convert import infos to the customized function
 * @param {Object} param0 specifier info
 * @return {expression} require expression
 */
function constructSyncRequire({
    local,
    type,
    imported,
    moduleName
}) {

    let declaration;
    switch (type) {
        case 'NAMESPACE':
            declaration = namespaceTemplate({
                LOCAL: t.identifier(local),
                MODULE_NAME: t.stringLiteral(moduleName)
            });
            break;

        case 'COMMON':
            imported = imported || local;
            declaration = commonTemplate({
                LOCAL: t.identifier(local),
                MODULE_NAME: t.stringLiteral(moduleName),
                IMPORTED: t.stringLiteral(imported)
            });
            break;

        case 'DEFAULT':
            declaration = defaultTemplate({
                LOCAL: t.identifier(local),
                MODULE_NAME: t.stringLiteral(moduleName)
            });
            break;

        case 'SIDE':
            declaration = sideTemplate({
                MODULE_NAME: t.stringLiteral(moduleName)
            })

        default:
            break;
    }

    return declaration;
}

const visitor = {
    // modify dynamic import
    Import: {
        enter(path) {
            let callNode = path.parentPath.node;
            let nameNode = callNode.arguments && callNode.arguments[0] ? callNode.arguments[0] : null;

            if (t.isCallExpression(callNode)
                && t.isStringLiteral(nameNode)
                && External_Scheme.test(nameNode.value)
            ) {
                let args = callNode.arguments;
                path.parentPath.replaceWith(
                    t.callExpression(
                        t.memberExpression(t.identifier(Async_Func), t.identifier(Async_Func_Attr), false),
                        args
                ));
            }
        }
    },

    // modify esm import
    ImportDeclaration: {
        enter(path) {
            // traverse and collect different specifiers
            path.traverse(specifierVisitor, { specifiers });
        },

        exit(path) {
            let moduleName = path.node.source.value;
            
            // if a external module
            if (t.isStringLiteral(path.node.source) && External_Scheme.test(moduleName)) {
                moduleName = moduleName.replace(External_Scheme, '');

                let nodes;
                if (specifiers.length === 0) {
                    nodes = constructSyncRequire({
                        moduleName,
                        type: 'SIDE'
                    });
                    nodes = [nodes]
                }
                else {
                    nodes = specifiers.map(s => {
                        s['moduleName'] = moduleName;
                        return constructSyncRequire(s);
                    });
                }

                // replacing with the customized require functions to passby webpack
                path.replaceWithMultiple(nodes);
            }

            specifiers = [];
        }
    }
}
/***************************************************************************************/

module.exports.visitor = visitor;
