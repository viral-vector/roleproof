import { createRouter, createWebHistory } from 'vue-router';

import AnalyzeView from '../features/analyze/AnalyzeView.vue';
import HomeView from '../features/home/HomeView.vue';
import PlaceholderView from '../features/placeholders/PlaceholderView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/analyze', component: AnalyzeView },
    {
      path: '/history',
      component: PlaceholderView,
      props: { title: 'History', description: 'Stored analysis history UI is still in progress.' },
    },
    {
      path: '/settings',
      component: PlaceholderView,
      props: {
        title: 'Settings',
        description: 'Provider and local database settings are still in progress.',
      },
    },
  ],
});
