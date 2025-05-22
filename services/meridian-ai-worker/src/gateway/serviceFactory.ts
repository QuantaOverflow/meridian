import { Env } from '../types';
import { TaskService } from './taskService';

export interface GatewayServices {
  task: TaskService;
}

let services: GatewayServices | null = null;

export function getGatewayServices(env: Env): GatewayServices {
  if (!services) {
    services = {
      task: new TaskService(env)
    };
  }
  return services;
}
