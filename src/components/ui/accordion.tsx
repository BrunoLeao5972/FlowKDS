/**
 * Componente Accordion baseado no Radix UI.
 * 
 * Esse arquivo cria uma versão estilizada do AccordionPrimitive
 * usando Tailwind + utilitário cn para combinar classes.
 */

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Root do Accordion.
 * 
 * É o componente principal que controla o comportamento:
 * - Se pode abrir múltiplos itens
 * - Se é single ou multiple
 */
const Accordion = AccordionPrimitive.Root;

/**
 * Item individual do Accordion.
 * 
 * Cada Item representa uma seção expansível.
 * Usamos forwardRef para permitir acesso à ref externamente.
 */
const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b", className)} // adiciona borda inferior + classes extras
    {...props}
  />
));

AccordionItem.displayName = "AccordionItem";

/**
 * Trigger do Accordion (botão clicável).
 * 
 * É a parte que o usuário clica para abrir/fechar.
 * Inclui ícone animado de seta.
 */
const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        /**
         * flex-1 → ocupa espaço disponível
         * justify-between → separa texto e ícone
         * hover:underline → underline ao passar mouse
         * [&[data-state=open]>svg]:rotate-180 → gira o ícone quando aberto
         */
        "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children}

      {/* Ícone de seta que rotaciona quando o item está aberto */}
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));

AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

/**
 * Conteúdo expansível do Accordion.
 * 
 * Essa parte aparece quando o item está aberto.
 * Inclui animações baseadas no estado (open/closed).
 */
const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="
      overflow-hidden 
      text-sm 
      transition-all 
      data-[state=closed]:animate-accordion-up 
      data-[state=open]:animate-accordion-down
    "
    {...props}
  >
    {/* Wrapper interno para aplicar padding */}
    <div className={cn("pb-4 pt-0", className)}>
      {children}
    </div>
  </AccordionPrimitive.Content>
));

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

/**
 * Exporta os componentes personalizados
 * para uso no restante do sistema.
 */
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };