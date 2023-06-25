import { FieldRef, FieldMetadata, Entity, ValueListItem, Remult, ValueListInfo } from "remult";


export type DataControlInfo<rowType> = DataControlSettings<rowType> | FieldRef<any, any>;
export interface DataControlSettings<entityType = any, valueType = any> {

    field?: FieldMetadata | FieldRef<any, any>;
    getValue?: (row: entityType, val: FieldRef<entityType, valueType>) => any;
    readonly?: ValueOrEntityExpression<boolean, entityType>;
    cssClass?: (string | ((row: entityType) => string));

    caption?: string;
    visible?: (row: entityType, val: FieldRef<entityType, valueType>) => boolean;

    click?: (row: entityType, val: FieldRef<entityType, valueType>) => void;
    valueChange?: (row: entityType, val: FieldRef<entityType, valueType>) => void;
    allowClick?: (row: entityType, val: FieldRef<entityType, valueType>) => boolean;
    clickIcon?: string;

    valueList?: ValueListItem[] | string[] | any[] | Promise<ValueListItem[]> | ((remult: Remult) => Promise<ValueListItem[]>) | ((remult) => ValueListItem[]);
    inputType?: string; //used: password,date,tel,text,checkbox,number
    hideDataOnInput?: boolean;//consider also setting the width of the data on input - for datas with long input
    useContainsFilter?: boolean;

    width?: string;
    customComponent?: {
        component: any,
        args?: any
    };
}

export interface CustomDataComponent<argsType = any> {
    args: CustomComponentArgs<argsType>;
}
export declare type CustomComponentArgs<argsType = any> = {
    fieldRef: FieldRef,
    settings: DataControlSettings,
    args?: argsType
}




export const configDataControlField = Symbol('configDataControlField');

export function getFieldDefinition(col: FieldMetadata | FieldRef<any, any>) {
    if (!col)
        return undefined;
    let r = col as FieldMetadata;
    let c = col as FieldRef<any, any>;
    if (c.metadata)
        r = c.metadata;
    return r;

}
export function decorateDataSettings(colInput: FieldMetadata | FieldRef<any, any>, x: DataControlSettings) {
    let col = getFieldDefinition(colInput);
    if (col.target) {
        let settingsOnColumnLevel = Reflect.getMetadata(configDataControlField, col.target, col.key);
        if (settingsOnColumnLevel) {
            for (const key in settingsOnColumnLevel) {
                if (Object.prototype.hasOwnProperty.call(settingsOnColumnLevel, key)) {
                    const element = settingsOnColumnLevel[key];
                    if (x[key] === undefined)
                        x[key] = element;
                }
            }
        }
    }
    if (col.valueType) {
        let settingsOnColumnLevel = Reflect.getMetadata(configDataControlField, col.valueType);
        if (settingsOnColumnLevel) {
            for (const key in settingsOnColumnLevel) {
                if (Object.prototype.hasOwnProperty.call(settingsOnColumnLevel, key)) {
                    const element = settingsOnColumnLevel[key];
                    if (x[key] === undefined)
                        x[key] = element;
                }
            }
        }
    }
    if (x.valueList === undefined && col && col.valueConverter instanceof ValueListInfo)
        x.valueList = col.valueConverter.getValues();


    if (!x.caption && col.caption)
        x.caption = col.caption;

    if (!x.inputType && col.inputType)
        x.inputType = col.inputType;

    if (x.readonly == undefined) {
        if (col.dbReadOnly)
            x.readonly = true;

        if (typeof col.options?.allowApiUpdate === 'boolean')
            x.readonly = !col.options.allowApiUpdate;
    }
}


export declare type ValueOrEntityExpression<valueType, entityType> = valueType | ((e: entityType) => valueType);


export function DataControl<entityType = any, colType = any>(settings: DataControlSettings<entityType, colType>) {
    return (target, key?) => {
        Reflect.defineMetadata(configDataControlField, settings, target, key);
        if (key === undefined)
            return target;
    }
}