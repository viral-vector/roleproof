import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './app/App.vue';
import { router } from './app/router.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

createApp(App).use(createPinia()).use(router).mount('#app');
