import Alert from 'ant-design-vue/es/alert';
import Button from 'ant-design-vue/es/button';
import Form from 'ant-design-vue/es/form';
import Input from 'ant-design-vue/es/input';
import InputNumber from 'ant-design-vue/es/input-number';
import Menu from 'ant-design-vue/es/menu';
import Modal from 'ant-design-vue/es/modal';
import Pagination from 'ant-design-vue/es/pagination';
import Radio from 'ant-design-vue/es/radio';
import Select from 'ant-design-vue/es/select';
import Spin from 'ant-design-vue/es/spin';
import Tag from 'ant-design-vue/es/tag';
import { createApp, type App as VueApp } from 'vue';

import App from '@/App.vue';
import { installGlobalErrorHandler } from '@/app/error-handler';
import { queryPluginOptions } from '@/app/query-client';
import { router } from '@/router';
import { pinia } from '@/stores';
import { VueQueryPlugin } from '@tanstack/vue-query';

export function createLingzhenApp(): VueApp<Element> {
  const app = createApp(App);

  installGlobalErrorHandler(app);
  app.use(pinia);
  app.use(router);
  app.use(VueQueryPlugin, queryPluginOptions);
  app.use(Alert);
  app.use(Button);
  app.use(Form);
  app.use(Input);
  app.use(InputNumber);
  app.use(Menu);
  app.use(Modal);
  app.use(Pagination);
  app.use(Radio);
  app.use(Select);
  app.use(Spin);
  app.use(Tag);

  return app;
}
