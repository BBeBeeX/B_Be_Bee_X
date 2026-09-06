import { registerRootComponent } from 'expo'
import { Root } from './src/App'

// `Root`, not `App`: it wraps the app in the safe-area provider, which has to
// sit above every `SafeAreaView` in the tree.
registerRootComponent(Root)
