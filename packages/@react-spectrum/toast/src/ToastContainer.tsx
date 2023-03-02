/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {AriaToastRegionProps} from '@react-aria/toast';
import React, {ReactElement, ReactNode, useEffect, useRef} from 'react';
import {SpectrumToastValue, Toast} from './Toast';
import {Toaster} from './Toaster';
import {ToastOptions, ToastQueue, useToastQueue} from '@react-stately/toast';
import {useLayoutEffect} from '@react-aria/utils';
import {useSyncExternalStore} from 'use-sync-external-store/shim/index.js';

export interface SpectrumToastContainerProps extends AriaToastRegionProps {}

export interface SpectrumToastOptions extends Omit<ToastOptions, 'priority'> {
  /** A label for the action button within the toast. */
  actionLabel?: ReactNode,
  /** Handler that is called when the action button is pressed. */
  onAction?: () => void,
  /** Whether the toast should automatically close when an action is performed. */
  shouldCloseOnAction?: boolean
}

type CloseFunction = () => void;

// There is a single global toast queue instance for the whole app, initialized lazily.
let globalToastQueue: ToastQueue<SpectrumToastValue> | null = null;
function getGlobalToastQueue() {
  if (!globalToastQueue) {
    globalToastQueue = new ToastQueue({
      maxVisibleToasts: 1,
      hasExitAnimation: true
    });
  }

  return globalToastQueue;
}

// For testing. Not exported from the package index.
export function clearToastQueue() {
  globalToastQueue = null;
}


let store = new Set();
let toastProviders = {
  add: (ref) => {
    store.add(ref);
    emitChange();
  },
  delete: (ref) => {
    store.delete(ref);
    emitChange();
  },
  values: () => store.values()
};
let subscriptions = new Set<() => void>();
function emitChange() {
  for (let fn of subscriptions) {
    fn();
  }
}
function subscribe(fn: () => void) {
  subscriptions.add(fn);
  return () => subscriptions.delete(fn);
}

function getActiveToastContainer() {
  return toastProviders.values().next().value;
}

function useActiveToastContainer() {
  return useSyncExternalStore(subscribe, getActiveToastContainer, getActiveToastContainer);
}

/**
 * A ToastContainer renders the queued toasts in an application. It should be placed
 * at the root of the app.
 */
export function ToastContainer(props: SpectrumToastContainerProps): ReactElement {
  // Track all toast provider instances in a set.
  // All will render null at first. Once they have been registered, all will re-render
  // and the last one will become the active toast provider, the rest will still return null.
  // We use a ref to do this, since it will have a stable identity
  // over the lifetime of the component.
  let ref = useRef();

  useLayoutEffect(() => {
    toastProviders.add(ref);
  }, [toastProviders, ref]);

  useEffect(() => {
    return () => {
      // When this toast provider unmounts, reset all animations so that
      // when the new toast provider renders, it is seamless.
      for (let toast of getGlobalToastQueue().visibleToasts) {
        toast.animation = null;
      }

      // Remove this toast provider.
      // This will cause all other instances to re-render,
      // and the first one to become the new active toast provider.
      toastProviders.delete(ref);
    };
  }, []);

  // Only render if this is the active toast provider instance, and there are visible toasts.
  let activeToastContainer = useActiveToastContainer();
  let state = useToastQueue(getGlobalToastQueue());
  if (ref === activeToastContainer && state.visibleToasts.length > 0) {
    return (
      <Toaster state={state} {...props}>
        {state.visibleToasts.map((toast) => (
          <Toast
            key={toast.key}
            toast={toast}
            state={state} />
        ))}
      </Toaster>
    );
  }

  return null;
}

function addToast(children: ReactNode, variant: SpectrumToastValue['variant'], options: SpectrumToastOptions = {}) {
  // Dispatch a custom event so that toasts can be intercepted and re-targeted, e.g. when inside an iframe.
  if (typeof CustomEvent !== 'undefined' && typeof window !== 'undefined') {
    let event = new CustomEvent('react-spectrum-toast', {
      cancelable: true,
      bubbles: true,
      detail: {
        children,
        variant,
        options
      }
    });

    let shouldContinue = window.dispatchEvent(event);
    if (!shouldContinue) {
      return;
    }
  }

  let value = {
    children,
    variant,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    shouldCloseOnAction: options.shouldCloseOnAction
  };

  // Minimum time of 5s from https://spectrum.adobe.com/page/toast/#Auto-dismissible
  // Actionable toasts cannot be auto dismissed. That would fail WCAG SC 2.2.1.
  // It is debatable whether non-actionable toasts would also fail.
  let timeout = options.timeout && !options.onAction ? Math.max(options.timeout, 5000) : null;
  let queue = getGlobalToastQueue();
  let key = queue.add(value, {priority: getPriority(variant, options), timeout, onClose: options.onClose});
  return () => queue.close(key);
}

const SpectrumToastQueue = {
  /** Queues a neutral toast. */
  neutral(children: ReactNode, options: SpectrumToastOptions = {}): CloseFunction {
    return addToast(children, 'neutral', options);
  },
  /** Queues a positive toast. */
  positive(children: ReactNode, options: SpectrumToastOptions = {}): CloseFunction {
    return addToast(children, 'positive', options);
  },
  /** Queues a negative toast. */
  negative(children: ReactNode, options: SpectrumToastOptions = {}): CloseFunction {
    return addToast(children, 'negative', options);
  },
  /** Queues an informational toast. */
  info(children: ReactNode, options: SpectrumToastOptions = {}): CloseFunction {
    return addToast(children, 'info', options);
  }
};

export {SpectrumToastQueue as ToastQueue};

// https://spectrum.adobe.com/page/toast/#Priority-queue
// TODO: if a lower priority toast comes in, no way to know until you dismiss the higher priority one.
const VARIANT_PRIORITY = {
  negative: 10,
  positive: 3,
  info: 2,
  neutral: 1
};

function getPriority(variant: SpectrumToastValue['variant'], options: SpectrumToastOptions) {
  let priority = VARIANT_PRIORITY[variant] || 1;
  if (options.onAction) {
    priority += 4;
  }
  return priority;
}
