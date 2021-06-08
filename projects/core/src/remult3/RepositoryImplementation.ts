
import { FieldDefinitions, FieldSettings, ValueConverter, ValueListItem } from "../column-interfaces";
import { EntitySettings } from "../entity";
import { CompoundIdField, LookupColumn, makeTitle } from '../column';
import { EntityDefinitions, filterOptions, EntityField, EntityFields, EntityWhere, filterOf, FindOptions, ClassType, Repository, sortOf, comparableFilterItem, rowHelper, IterateOptions, IteratableResult, EntityOrderBy, FieldDefinitionsOf, supportsContains } from "./remult3";
import { allEntities, Allowed, Context, EntityAllowed, iterateConfig, IterateToArrayOptions, setControllerSettings } from "../context";
import { AndFilter, Filter, OrFilter } from "../filter/filter-interfaces";
import { Sort, SortSegment } from "../sort";

import { Lookup } from "../lookup";
import { DataApiSettings } from "../data-api";
import { RowEvents } from "../__EntityValueProvider";
import { DataProvider, EntityDataProvider, EntityDataProviderFindOptions, ErrorInfo } from "../data-interfaces";
import { BoolValueConverter, DateOnlyValueConverter, DateValueConverter, DecimalValueConverter, DefaultValueConverter, IntValueConverter, ValueListValueConverter } from "../../valueConverters";


export class RepositoryImplementation<T> implements Repository<T>{
    createAfterFilter(orderBy: EntityOrderBy<T>, lastRow: T): EntityWhere<T> {
        let values = new Map<string, any>();

        for (const s of Sort.translateOrderByToSort(this.defs, orderBy).Segments) {
            values.set(s.field.key, lastRow[s.field.key]);
        }
        return x => {
            let r: Filter = undefined;
            let equalToColumn: FieldDefinitions[] = [];
            for (const s of Sort.translateOrderByToSort(this.defs, orderBy).Segments) {
                let f: Filter;
                for (const c of equalToColumn) {
                    f = new AndFilter(f, new Filter(x => x.isEqualTo(c, values.get(c.key))));
                }
                equalToColumn.push(s.field);
                if (s.isDescending) {
                    f = new AndFilter(f, new Filter(x => x.isLessThan(s.field, values.get(s.field.key))));
                }
                else
                    f = new AndFilter(f, new Filter(x => x.isGreaterThan(s.field, values.get(s.field.key))));
                r = new OrFilter(r, f);
            }
            return r;
        }
    }
    createAUniqueSort(orderBy: EntityOrderBy<T>): EntityOrderBy<T> {
        if (!orderBy)
            orderBy = this._info.entityInfo.defaultOrderBy;
        if (!orderBy)
            orderBy = x => ({ field: this._info.idField })
        return x => {
            let sort = Sort.translateOrderByToSort(this.defs, orderBy);
            if (!sort.Segments.find(x => x.field == this.defs.idField)) {
                sort.Segments.push({ field: this.defs.idField });
            }
            return sort.Segments;
        }
    }
    private _info: EntityFullInfo<T>;
    private _lookup = new Lookup(this);
    private __edp: EntityDataProvider;
    private get edp() {
        return this.__edp ? this.__edp : this.__edp = this.dataProvider.getEntityDataProvider(this.defs);
    }
    constructor(private entity: ClassType<T>, private context: Context, private dataProvider: DataProvider) {
        this._info = createOldEntity(entity, context);
    }
    idCache = new Map<any, any>();
    getCachedById(id: any): T {
        this.getCachedByIdAsync(id);
        let r = this.idCache.get(id);
        if (r instanceof Promise)
            return undefined;
        return r;
    }
    async getCachedByIdAsync(id: any): Promise<T> {

        let r = this.idCache.get(id);
        if (r instanceof Promise)
            return await r;
        if (this.idCache.has(id)) {
            return r;
        }
        this.idCache.set(id, undefined);
        let row = this.findId(id).then(row => {
            if (row === undefined) {
                r = null;
            }
            else
                r = row;
            this.idCache.set(id, r);
            return r;
        });
        this.idCache.set(id, row);
        return await row;
    }
    addToCache(item: T) {
        if (item)
            this.idCache.set(this.getRowHelper(item).getId(), item);
    }
    fromJson(x: any): T {
        throw new Error("Method not implemented.");
    }

    get defs(): EntityDefinitions { return this._info };

    _getApiSettings(): DataApiSettings<T> {
        let options = this._info.entityInfo;
        if (options.allowApiCrud !== undefined) {
            if (options.allowApiDelete === undefined)
                options.allowApiDelete = options.allowApiCrud;
            if (options.allowApiInsert === undefined)
                options.allowApiInsert = options.allowApiCrud;
            if (options.allowApiUpdate === undefined)
                options.allowApiUpdate = options.allowApiCrud;
            if (options.allowApiRead === undefined)
                options.allowApiRead = options.allowApiCrud;
        }

        return {
            name: options.key,
            allowRead: this.context.isAllowed(options.allowApiRead),
            allowUpdate: (e) => checkEntityAllowed(this.context, options.allowApiUpdate, e),
            allowDelete: (e) => checkEntityAllowed(this.context, options.allowApiDelete, e),
            allowInsert: (e) => checkEntityAllowed(this.context, options.allowApiInsert, e),
            requireId: this.context.isAllowed(options.apiRequireId),
            get: {
                where: x => {
                    if (options.apiDataFilter) {
                        return options.apiDataFilter(x, this.context);
                    }
                    return undefined;
                }
            }
        }
    }

    isIdField(col: FieldDefinitions<any>): boolean {
        return col.key == this.defs.idField.key;
    }
    getIdFilter(id: any): Filter {
        return new Filter(x => x.isEqualTo(this.defs.idField, id));
    }


    iterate(options?: EntityWhere<T> | IterateOptions<T>): IteratableResult<T> {
        let opts: IterateOptions<T> = {};
        if (options) {
            if (typeof options === 'function')
                opts.where = <any>options;
            else
                opts = <any>options;
        }

        let cont = this;
        let _count: number;
        let self = this;
        let r = new class {

            async toArray(options?: IterateToArrayOptions) {
                if (!options) {
                    options = {};
                }


                return cont.find({
                    where: opts.where,
                    orderBy: opts.orderBy,
                    limit: options.limit,
                    page: options.page
                });
            }
            async first() {
                let r = await cont.find({
                    where: opts.where,
                    orderBy: opts.orderBy,
                    limit: 1
                });
                if (r.length == 0)
                    return undefined;
                return r[0];
            }

            async count() {
                if (_count === undefined)
                    _count = await cont.count(opts.where);
                return _count;

            }
            async forEach(what: (item: T) => Promise<any>) {
                let i = 0;
                for await (const x of this) {
                    await what(x);
                    i++;
                }
                return i;
            }

            //@ts-ignore
            [Symbol.asyncIterator]() {

                if (!opts.where) {
                    opts.where = x => undefined;
                }
                opts.orderBy = self.createAUniqueSort(opts.orderBy);
                let pageSize = iterateConfig.pageSize;


                let itemIndex = -1;
                let items: T[];

                let itStrategy: (() => Promise<IteratorResult<T>>);
                let nextPageFilter: EntityWhere<T> = x => undefined;;

                let j = 0;

                itStrategy = async () => {
                    if (opts.progress) {
                        opts.progress.progress(j++ / await this.count());
                    }
                    if (items === undefined || itemIndex == items.length) {
                        if (items && items.length < pageSize)
                            return { value: <T>undefined, done: true };
                        items = await cont.find({
                            where: [opts.where, nextPageFilter],
                            orderBy: opts.orderBy,
                            limit: pageSize
                        });
                        itemIndex = 0;
                        if (items.length == 0) {
                            return { value: <T>undefined, done: true };
                        } else {
                            nextPageFilter = self.createAfterFilter(opts.orderBy, items[items.length - 1]);
                        }

                    }
                    if (itemIndex < items.length)
                        return { value: items[itemIndex++], done: false };


                };
                return {
                    next: async () => {
                        let r = itStrategy();
                        return r;
                    }
                };
            }

        }
        return r;
    }
    async findOrCreate(options?: EntityWhere<T> | IterateOptions<T>): Promise<T> {

        let r = await this.iterate(options).first();
        if (!r) {
            r = this.create();
            if (options) {
                let opts: IterateOptions<T> = {};
                if (options) {
                    if (typeof options === 'function')
                        opts.where = <any>options;
                    else
                        opts = <any>options;
                }
                if (opts.where) {
                    __updateEntityBasedOnWhere(this.defs, opts.where, r);
                }
            }
            return r;
        }
        return r;
    }
    lookup(filter: EntityWhere<T>): T {
        return this._lookup.get(filter);
    }
    async lookupAsync(filter: EntityWhere<T>): Promise<T> {
        return this._lookup.whenGet(filter);
    }
    getRowHelper(entity: T): rowHelper<T> {
        let x = entity[entityMember];
        if (!x) {
            x = new rowHelperImplementation(this._info, entity, this, this.edp, this.context, true);
            Object.defineProperty(entity, entityMember, {//I've used define property to hide this member from console.log
                get: () => x
            })

        }
        return x;
    }

    async delete(entity: T): Promise<void> {
        await this.getRowHelper(entity).delete();
    }
    async save(entity: T): Promise<T> {
        return await this.getRowHelper(entity).save();
    }
    async find(options?: FindOptions<T>): Promise<T[]> {
        let opt: EntityDataProviderFindOptions = {};
        if (!options)
            options = {};

        opt = {};
        if (!options.orderBy) {
            options.orderBy = this._info.entityInfo.defaultOrderBy;
        }
        opt.where = this.translateWhereToFilter(options.where);
        opt.orderBy = Sort.translateOrderByToSort(this.defs, options.orderBy);

        opt.limit = options.limit;
        opt.page = options.page;

        let rawRows = await this.edp.find(opt);
        let result = await Promise.all(rawRows.map(async r =>
            await this.mapRawDataToResult(r)
        ));
        return result;

    }

    private async mapRawDataToResult(r: any) {
        if (!r)
            return undefined;
        let x = new this.entity(this.context);
        let helper = new rowHelperImplementation(this._info, x, this, this.edp, this.context, false);
        await helper.loadDataFrom(r);
        helper.saveOriginalData();

        Object.defineProperty(x, entityMember, {//I've used define property to hide this member from console.log
            get: () => helper
        })
        return x;
    }

    async count(where?: EntityWhere<T>): Promise<number> {
        return this.edp.count(this.translateWhereToFilter(where));
    }
    async findFirst(options?: EntityWhere<T> | IterateOptions<T>): Promise<T> {

        return this.iterate(options).first();
    }


    create(item?: Partial<T>): T {
        let r = new this.entity(this.context);
        let z = this.getRowHelper(r);
        if (item)
            Object.assign(r, item);

        return r;
    }
    findId(id: any): Promise<T> {
        return this.iterate(x => x[this.defs.idField.key].isEqualTo(id)).first();
    }

    createIdInFilter(items: T[]): Filter {
        let idField = this.defs.idField;
        return new Filter(x => x.isIn(idField, items.map(i => this.getRowHelper(i).fields[idField.key].value)))

    }



    private translateWhereToFilter(where: EntityWhere<T>): Filter {
        if (this.defs.evilOriginalSettings.fixedFilter)
            where = [where, this.defs.evilOriginalSettings.fixedFilter];
        return Filter.translateWhereToFilter(Filter.createFilterOf(this.defs), where);
    }

}

export function __updateEntityBasedOnWhere<T>(entityDefs: EntityDefinitions<T>, where: EntityWhere<T>, r: T) {
    let w = Filter.translateWhereToFilter(Filter.createFilterOf(entityDefs), where);

    if (w) {
        w.__applyToConsumer({
            containsCaseInsensitive: () => { },
            isDifferentFrom: () => { },
            isEqualTo: (col, val) => {
                r[col.key] = val;
            },
            isGreaterOrEqualTo: () => { },
            isGreaterThan: () => { },
            isIn: () => { },
            isLessOrEqualTo: () => { },
            isLessThan: () => { },
            isNotNull: () => { },
            isNull: () => { },
            startsWith: () => { },
            or: () => { }
        });
    }
}



export const entityInfo = Symbol("entityInfo");
const entityMember = Symbol("entityMember");
export function getEntitySettings<T>(entity: ClassType<T>, throwError = true) {
    if (entity === undefined)
        if (throwError) {
            throw new Error("Undefined is not an entity :)")
        }
        else return undefined;
    let info: EntitySettings = Reflect.getMetadata(entityInfo, entity);
    if (!info && throwError)
        throw new Error(entity.prototype.constructor.name + " is not a known entity, did you forget to set @Entity() or did you forget to add the '@' before the call to Entity?")

    return info;
}
export const columnsOfType = new Map<any, columnInfo[]>();
export function createOldEntity<T>(entity: ClassType<T>, context: Context) {
    let r: columnInfo[] = columnsOfType.get(entity);
    if (!r)
        columnsOfType.set(entity, r = []);

    let info = getEntitySettings(entity);


    let base = Object.getPrototypeOf(entity);
    while (base != null) {

        let baseCols = columnsOfType.get(base);
        if (baseCols) {
            r.unshift(...baseCols.filter(x => !r.find(y => y.key == x.key)));
        }
        base = Object.getPrototypeOf(base);
    }


    return new EntityFullInfo<T>(prepareColumnInfo(r), info, context);
}

class rowHelperBase<T>
{
    error: string;
    constructor(protected columnsInfo: columnInfo[], protected instance: T, protected context: Context) {
        for (const col of columnsInfo) {
            let ei = getEntitySettings(col.settings.dataType, false);

            if (ei && context) {
                let lookup = new LookupColumn(context.for(col.settings.dataType), undefined);
                this.lookups.set(col.key, lookup);
                let val = instance[col.key];
                Object.defineProperty(instance, col.key, {
                    get: () =>
                        lookup.item,
                    set: (val) =>
                        lookup.set(val),
                    enumerable: true
                });
                instance[col.key] = val;
            }
        }
    }
    lookups = new Map<string, LookupColumn<any>>();
    async waitLoad() {
        await Promise.all([...this.lookups.values()].map(x => x.waitLoad()));
    }
    errors: { [key: string]: string };
    protected __assertValidity() {
        if (!this.hasErrors()) {
            let error: ErrorInfo = {
                modelState: Object.assign({}, this.errors),
                message: this.error
            }
            if (!error.message) {
                for (const col of this.columnsInfo) {
                    if (this.errors[col.key]) {
                        error.message = col.settings.caption + ": " + this.errors[col.key];
                    }
                }

            }
            throw error;


        }
    }
    catchSaveErrors(err: any): any {
        let e = err;

        if (e instanceof Promise) {
            return e.then(x => this.catchSaveErrors(x));
        }
        if (e.error) {
            e = e.error;
        }

        if (e.message)
            this.error = e.message;
        else if (e.Message)
            this.error = e.Message;
        else this.error = e;
        let s = e.modelState;
        if (!s)
            s = e.ModelState;
        if (s) {
            this.errors = s;
        }
        throw err;

    }
    __clearErrors() {
        this.errors = undefined;
        this.error = undefined;
    }
    hasErrors(): boolean {
        return !!!this.error && this.errors == undefined;

    }
    protected copyDataToObject() {
        let d: any = {};
        for (const col of this.columnsInfo) {
            let lu = this.lookups.get(col.key);
            if (lu)
                d[col.key] = lu.id;
            else
                d[col.key] = this.instance[col.key];
        }
        return d;
    }
    originalValues: any = {};
    saveOriginalData() {
        this.originalValues = this.copyDataToObject();
    }
    async __validateEntity(afterValidationBeforeSaving?: (row: T) => Promise<any> | any) {
        this.__clearErrors();

        await this.__performColumnAndEntityValidations();
        if (afterValidationBeforeSaving)
            await afterValidationBeforeSaving(this.instance);
        this.__assertValidity();
    }
    async __performColumnAndEntityValidations() {

    }
    toApiJson() {
        let result: any = {};
        for (const col of this.columnsInfo) {
            if (!this.context || col.settings.includeInApi === undefined || this.context.isAllowed(col.settings.includeInApi)) {
                let val = this.instance[col.key];
                let lu = this.lookups.get(col.key);
                if (lu)
                    val = lu.id;
                else if (!this.context) {
                    if (val) {
                        let eo = getEntitySettings(val.constructor, false);
                        if (eo) {
                            val = getEntityOf(val).getId();
                        }
                    }
                }
                result[col.key] = col.settings.valueConverter.toJson(val);
            }
        }
        return result;
    }

    _updateEntityBasedOnApi(body: any) {
        for (const col of this.columnsInfo) {
            if (body[col.key] !== undefined)
                if (col.settings.includeInApi === undefined || this.context.isAllowed(col.settings.includeInApi)) {
                    if (!this.context || col.settings.allowApiUpdate === undefined || checkEntityAllowed(this.context, col.settings.allowApiUpdate, this.instance)) {
                        let lu = this.lookups.get(col.key);
                        if (lu)
                            lu.id = body[col.key];
                        else
                            this.instance[col.key] = col.settings.valueConverter.fromJson(body[col.key]);
                    }

                }
        }

    }
}
export class rowHelperImplementation<T> extends rowHelperBase<T> implements rowHelper<T> {



    constructor(private info: EntityFullInfo<T>, instance: T, public repository: Repository<T>, private edp: EntityDataProvider, context: Context, private _isNew: boolean) {
        super(info.columnsInfo, instance, context);

        if (_isNew) {
            for (const col of info.columnsInfo) {

                if (col.settings.defaultValue) {
                    if (typeof col.settings.defaultValue === "function") {
                        instance[col.key] = col.settings.defaultValue(instance, context);
                    }
                    else if (!instance[col.key])
                        instance[col.key] = col.settings.defaultValue;
                }

            }
        }
    }
    getId() {
        return this.instance[this.info.idField.key];
    }


    private _wasDeleted = false;

    listeners: RowEvents[];
    register(listener: RowEvents) {
        if (!this.listeners)
            this.listeners = []
        this.listeners.push(listener);
    }



    wasDeleted(): boolean {
        return this._wasDeleted;
    }

    undoChanges() {
        this.loadDataFrom(this.originalValues);
        this.__clearErrors();
    }
    async reload(): Promise<void> {
        return this.edp.find({ where: this.repository.getIdFilter(this.id) }).then(async newData => {
            await this.loadDataFrom(newData[0]);
        });
    }

    private _columns: EntityFields<T>;

    get fields(): EntityFields<T> {
        if (!this._columns) {
            let _items = [];
            let r = {
                find: (c: FieldDefinitions<T>) => r[c.key],
                [Symbol.iterator]: () => _items[Symbol.iterator]()
            };
            for (const c of this.info.columnsInfo) {
                _items.push(r[c.key] = new columnImpl(c.settings, this.info.fields[c.key], this.instance, this, this));
            }

            this._columns = r as unknown as EntityFields<T>;
        }
        return this._columns;

    }

    async save(afterValidationBeforeSaving?: (row: T) => Promise<any> | any): Promise<T> {
        await this.__validateEntity(afterValidationBeforeSaving);
        let doNotSave = false;
        if (this.info.entityInfo.saving) {
            await this.info.entityInfo.saving(this.instance, () => doNotSave = true);
        }

        this.__assertValidity();

        let d = this.copyDataToObject();
        if (this.info.idField instanceof CompoundIdField)
            d.id = undefined;
        let updatedRow: any;
        try {
            if (this.isNew()) {
                updatedRow = await this.edp.insert(d);
            }
            else {
                if (doNotSave) {
                    updatedRow = (await this.edp.find({ where: this.repository.getIdFilter(this.id) }))[0];
                }
                else
                    updatedRow = await this.edp.update(this.id, d);
            }
            await this.loadDataFrom(updatedRow);
            if (this.info.entityInfo.saved)
                await this.info.entityInfo.saved(this.instance);
            if (this.listeners)
                this.listeners.forEach(x => {
                    if (x.rowSaved)
                        x.rowSaved(true);
                });
            this.saveOriginalData();
            this._isNew = false;
            return this.instance;
        }
        catch (err) {
            await this.catchSaveErrors(err);
        }

    }





    async delete() {
        this.__clearErrors();
        if (this.info.entityInfo.deleting)
            await this.info.entityInfo.deleting(this.instance);
        this.__assertValidity();

        try {
            await this.edp.delete(this.id);
            if (this.info.entityInfo.deleted)
                await this.info.entityInfo.deleted(this.instance);
            if (this.listeners) {
                for (const l of this.listeners) {
                    if (l.rowDeleted)
                        l.rowDeleted();
                }
            }
            this._wasDeleted = true;
        } catch (err) {
            await this.catchSaveErrors(err);
        }
    }

    async loadDataFrom(data: any) {
        for (const col of this.info.fields) {
            let lu = this.lookups.get(col.key);
            if (lu)
                lu.id = data[col.key];
            else
                this.instance[col.key] = data[col.key];
        }
        await this.calcServerExpression();
        if (this.repository.defs.idField instanceof CompoundIdField) {
            data.columns.idField.__addIdToPojo(data);
        }
        this.id = data[this.repository.defs.idField.key];
    }
    private id;

    private async calcServerExpression() {
        if (this.context.onServer)
            for (const col of this.info.columnsInfo) {
                if (col.settings.serverExpression) {
                    this.instance[col.key] = await col.settings.serverExpression(this.instance);
                }
            }
    }

    isNew(): boolean {
        return this._isNew;
    }
    wasChanged(): boolean {
        for (const col of this.info.fields) {
            let val = this.instance[col.key];
            let lu = this.lookups.get(col.key);
            if (lu) {
                val = lu.id;
            }
            if (col.valueConverter.toJson(val) != col.valueConverter.toJson(this.originalValues[col.key]))
                return true;
        }
        return false;
    }

    async __performColumnAndEntityValidations() {
        for (const c of this.columnsInfo) {
            if (c.settings.validate) {
                let col = new columnImpl(c.settings, this.info.fields[c.key], this.instance, this, this);
                await col.__performValidation();
            }
        }

        if (this.info.entityInfo.validation)
            await this.info.entityInfo.validation(this.instance);
    }
}
const controllerColumns = Symbol("controllerColumns");
function prepareColumnInfo(r: columnInfo[]): columnInfo[] {
    return r.map(x => ({
        key: x.key,
        type: x.type,
        settings: decorateColumnSettings(x.settings)
    }));
}

export function getControllerDefs<T>(controller: T, context?: Context): controllerDefsImpl<T> {

    let result = controller[controllerColumns] as controllerDefsImpl<any>;
    if (!result)
        result = controller[entityMember];
    if (!result) {
        let columnSettings: columnInfo[] = columnsOfType.get(controller.constructor);
        if (!columnSettings)
            columnsOfType.set(controller.constructor, columnSettings = []);
        controller[controllerColumns] = result = new controllerDefsImpl(prepareColumnInfo(columnSettings), controller, context);
    }
    return result;
}

export interface controllerDefs<T = any> {
    readonly fields: EntityFields<T>,
}
export class controllerDefsImpl<T = any> extends rowHelperBase<T> implements controllerDefs<T> {
    constructor(columnsInfo: columnInfo[], instance: any, context: Context) {
        super(columnsInfo, instance, context);


        let _items = [];
        let r = {
            find: (c: EntityField<any, T>) => r[c.defs.key],
            [Symbol.iterator]: () => _items[Symbol.iterator]()
        };

        for (const col of columnsInfo) {
            let settings = decorateColumnSettings(col.settings);
            _items.push(r[col.key] = new columnImpl<any, any>(settings, new columnDefsImpl(col, undefined, context), instance, undefined, this));
        }

        this.fields = r as unknown as EntityFields<T>;


    }
    async __performColumnAndEntityValidations() {
        for (const col of this.fields) {
            if (col instanceof columnImpl) {
                await col.__performValidation();
            }
        }
    }
    errors: { [key: string]: string; };
    originalValues: any;
    fields: EntityFields<T>;

}
export class columnImpl<colType, rowType> implements EntityField<colType, rowType> {
    constructor(private settings: FieldSettings, public defs: FieldDefinitions, public entity: any, private helper: rowHelper<rowType>, private rowBase: rowHelperBase<rowType>) {

    }
    async load(): Promise<colType> {
        let lu = this.rowBase.lookups.get(this.defs.key);
        if (lu) {
            if (this.wasChanged()) {
                await lu.waitLoadOf(this.rawOriginalValue());
            }
            return await lu.waitLoad();
        }
        return this.value;
    }
    target: ClassType<any> = this.settings.target;


    inputType: string = this.settings.inputType;

    get error(): string {
        if (!this.rowBase.errors)
            return undefined;
        return this.rowBase.errors[this.defs.key];
    }
    set error(error: string) {
        if (!this.rowBase.errors)
            this.rowBase.errors = {};
        this.rowBase.errors[this.defs.key] = error;
    }
    get displayValue(): string {
        if (this.value != undefined) {
            if (this.settings.displayValue)
                return this.settings.displayValue(this.entity, this.value);
            else if (this.defs.valueConverter.displayValue)
                return this.defs.valueConverter.displayValue(this.value);
            else
                return this.value.toString();
        }
        return "";
    };
    get value() { return this.entity[this.defs.key] };
    set value(value: any) { this.entity[this.defs.key] = value };
    get originalValue(): any {
        let lu = this.rowBase.lookups.get(this.defs.key);
        if (lu)
            return lu.get(this.rawOriginalValue());
        return this.rowBase.originalValues[this.defs.key];
    };
    private rawOriginalValue(): any {
        return this.rowBase.originalValues[this.defs.key];
    }

    get inputValue(): string {
        let lu = this.rowBase.lookups.get(this.defs.key);
        if (lu)
            return lu.id != undefined ? lu.id.toString() : null;
        return this.defs.valueConverter.toInput(this.value, this.settings.inputType);
    }
    set inputValue(val: string) {
        let lu = this.rowBase.lookups.get(this.defs.key);
        if (lu) {
            lu.setId(val);
        }
        else
            this.value = this.defs.valueConverter.fromInput(val, this.settings.inputType);
    };
    wasChanged(): boolean {
        let val = this.value;
        let lu = this.rowBase.lookups.get(this.defs.key);
        if (lu) {
            val = lu.id;
        }
        return this.defs.valueConverter.toJson(this.rowBase.originalValues[this.defs.key]) != this.defs.valueConverter.toJson(val);
    }
    rowHelper: rowHelper<any> = this.helper;


    async __performValidation() {
        let x = typeof (this.settings.validate);
        if (Array.isArray(this.settings.validate)) {
            for (const v of this.settings.validate) {
                await v(this.entity, this);
            }
        } else if (typeof this.settings.validate === 'function')
            await this.settings.validate(this.entity, this);
    }




}

export function getEntityOf<T>(item: T): rowHelper<T> {
    let x = item[entityMember];
    if (!x)
        throw new Error("item " + item + " was not initialized using a context");
    return x;

}
export const CaptionHelper = {
    determineCaption: (context: Context, key: string, caption: string) => caption
}
export function buildCaption(caption: string | ((context: Context) => string), key: string, context: Context): string {
    let result: string;
    if (typeof (caption) === "function") {
        if (context)
            result = caption(context);
    }
    else if (caption)
        result = caption;
    result = CaptionHelper.determineCaption(context, key, result);
    if (result)
        return result;
    return makeTitle(key);
}

export class columnDefsImpl implements FieldDefinitions {
    constructor(private colInfo: columnInfo, private entityDefs: EntityFullInfo<any>, private context: Context) {
        if (colInfo.settings.serverExpression)
            this.isServerExpression = true;
        if (colInfo.settings.sqlExpression)
            this.dbReadOnly = true;
        if (typeof (this.colInfo.settings.allowApiUpdate) === "boolean")
            this.readonly = this.colInfo.settings.allowApiUpdate;
        if (!this.inputType)
            this.inputType = this.valueConverter.inputType;
        this.caption = buildCaption(colInfo.settings.caption, colInfo.key, context);




    }
    evilOriginalSettings: FieldSettings<any, any> = this.colInfo.settings;
    target: ClassType<any> = this.colInfo.settings.target;
    readonly: boolean;

    valueConverter = this.colInfo.settings.valueConverter;
    allowNull = !!this.colInfo.settings.allowNull;

    caption: string;
    get dbName() {
        let result;
        if (this.colInfo.settings.sqlExpression) {
            if (typeof this.colInfo.settings.sqlExpression === "function") {
                result = this.colInfo.settings.sqlExpression(this.entityDefs, this.context);
            } else
                result = this.colInfo.settings.sqlExpression;
        }
        if (result)
            return result;
        return this.colInfo.settings.dbName;

    }
    inputType = this.colInfo.settings.inputType;
    key = this.colInfo.settings.key;
    dbReadOnly = this.colInfo.settings.dbReadOnly;
    isServerExpression: boolean;
    dataType = this.colInfo.settings.dataType;
}
class EntityFullInfo<T> implements EntityDefinitions<T> {

    evilOriginalSettings = this.entityInfo;

    constructor(public columnsInfo: columnInfo[], public entityInfo: EntitySettings, private context: Context) {


        let _items = [];
        let r = {
            find: (c: FieldDefinitions<any>) => r[c.key],
            [Symbol.iterator]: () => _items[Symbol.iterator](),

        };

        for (const x of columnsInfo) {
            _items.push(r[x.key] = new columnDefsImpl(x, this, context));
        }

        this.fields = r as unknown as FieldDefinitionsOf<T>;

        this.dbAutoIncrementId = entityInfo.dbAutoIncrementId;
        this.key = entityInfo.key;
        this.caption = buildCaption(entityInfo.caption, entityInfo.key, context);
        if (typeof entityInfo.dbName === "string")
            this.dbName = entityInfo.dbName;
        else if (typeof entityInfo.dbName === "function")
            this.dbName = entityInfo.dbName(this.fields, context);
        if (entityInfo.id) {
            this.idField = entityInfo.id(this.fields)
        } else {
            if (this.fields["id"])
                this.idField = this.fields["id"];
            else
                this.idField = [...this.fields][0];
        }
    }


    dbAutoIncrementId: boolean;
    idField: FieldDefinitions<any>;
    fields: FieldDefinitionsOf<T>;


    key: string;
    dbName: string;
    caption: string;


}




export function FieldType<T = any>(settings?: FieldSettings<T, any>) {
    return target => {
        if (!settings) {
            settings = {};
        }
        if (!settings.dataType)
            settings.dataType = target;
        Reflect.defineMetadata(storableMember, settings, target);
        return target;
    }

}
export function DateOnlyField<T = any>(settings?: FieldSettings<Date, T>) {
    return Field({
        valueConverter: DateOnlyValueConverter
        , ...settings
    })
}
export function DecimalField<T = any>(settings?: FieldSettings<Number, T>) {
    return Field({
        valueConverter: DecimalValueConverter
        , ...settings
    })
}
export function ValueListFieldType<T = any, colType extends ValueListItem = any>(type: ClassType<colType>, settings?: FieldSettings<colType, T>) {
    return FieldType<colType>({
        valueConverter: new ValueListValueConverter(type),
        displayValue: (item, val) => val.caption
        , ...settings
    })
}

export function Field<T = any, colType = any>(settings?: FieldSettings<colType, T>) {
    if (!settings) {
        settings = {};
    }


    return (target, key, c?) => {
        if (!settings.key) {
            settings.key = key;
        }

        if (!settings.dbName)
            settings.dbName = settings.key;

        let names: columnInfo[] = columnsOfType.get(target.constructor);
        if (!names) {
            names = [];
            columnsOfType.set(target.constructor, names)
        }

        let type = settings.dataType;
        if (!type) {
            type = Reflect.getMetadata("design:type", target, key);
            settings.dataType = type;
        }
        if (!settings.target)
            settings.target = target;

        let set = names.find(x => x.key == key);
        if (!set)
            names.push({
                key,
                settings,
                type
            });
        else {
            Object.assign(set.settings, settings);
        }

    }



}
const storableMember = Symbol("storableMember");
export function decorateColumnSettings<T>(settings: FieldSettings<T>) {

    if (settings.dataType) {
        let settingsOnTypeLevel = Reflect.getMetadata(storableMember, settings.dataType);
        if (settingsOnTypeLevel) {
            settings = {
                ...settingsOnTypeLevel,
                ...settings
            }
        }
    }

    if (settings.dataType == String) {
        let x = settings as unknown as FieldSettings<String>;
        if (!settings.valueConverter)
            x.valueConverter = {
                toJson: x => x,
                fromJson: x => x
            };
    }

    if (settings.dataType == Number) {
        let x = settings as unknown as FieldSettings<Number>;
        if (!settings.valueConverter)
            x.valueConverter = IntValueConverter;
    }
    if (settings.dataType == Date) {
        let x = settings as unknown as FieldSettings<Date>;
        if (!settings.valueConverter) {
            x.valueConverter = DateValueConverter;
        }
    }

    if (settings.dataType == Boolean) {
        let x = settings as unknown as FieldSettings<Boolean>;
        if (!x.valueConverter)
            x.valueConverter = BoolValueConverter;

    }
    if (!settings.valueConverter) {
        settings.valueConverter = DefaultValueConverter;
    }
    if (!settings.valueConverter.toJson) {
        settings.valueConverter.toJson = x => x;
    }
    if (!settings.valueConverter.fromJson) {
        settings.valueConverter.fromJson = x => x;
    }
    if (!settings.valueConverter.toDb) {
        settings.valueConverter.toDb = x => settings.valueConverter.toJson(x);
    }
    if (!settings.valueConverter.fromDb) {
        settings.valueConverter.fromDb = x => settings.valueConverter.fromJson(x);
    }
    if (!settings.valueConverter.toInput) {
        settings.valueConverter.toInput = x => settings.valueConverter.toJson(x);
    }
    if (!settings.valueConverter.fromInput) {
        settings.valueConverter.fromInput = x => settings.valueConverter.fromJson(x);
    }





    return settings;
}

interface columnInfo {
    key: string;
    settings: FieldSettings,
    type: any
}
export function Entity<T>(options: EntitySettings<T>) {
    return target => {
        if (!options.key || options.key == '')
            options.key = target.name;
        let base = Object.getPrototypeOf(target);
        if (base) {
            let opt = Reflect.getMetadata(entityInfo, target);
            if (opt) {
                options = {
                    ...opt,
                    ...options
                }
            }
        }
        if (!options.dbName)
            options.dbName = options.key;
        allEntities.push(target);
        setControllerSettings(target, { allowed: false, key: undefined })
        Reflect.defineMetadata(entityInfo, options, target);
        return target;
    }
}




export class CompoundId implements FieldDefinitions<string>{
    constructor(...columns: FieldDefinitions[]) {
        if (false)
            console.log(columns);
    }
    evilOriginalSettings: FieldSettings<any, any>;
    valueConverter: ValueConverter<string>;
    target: ClassType<any>;
    readonly: true;

    allowNull: boolean;
    dbReadOnly: boolean;
    isServerExpression: boolean;
    key: string;
    caption: string;
    inputType: string;
    dbName: string;

    dataType: any;


}
function checkEntityAllowed(context: Context, x: EntityAllowed<any>, entity: any) {
    if (Array.isArray(x)) {
        {
            for (const item of x) {
                if (checkEntityAllowed(context, item, entity))
                    return true;
            }
        }
    }
    else if (typeof (x) === "function") {
        return x(context, entity)
    } else return context.isAllowed(x as Allowed);
}
export class EntityBase {
    get _(): rowHelper<this> { return getEntityOf(this) }
    save() { return this._.save(); }
    delete() { return this._.delete(); }
    isNew() { return this._.isNew(); }
    wasChanged() { return this._.wasChanged(); }
    get $() { return this._.fields }
}